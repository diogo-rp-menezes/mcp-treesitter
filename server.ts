import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { projectStore } from './src/server/store';
import { parseSourceToAST, detectLanguage, extractSymbolsFromAST, findNodeAtPosition } from './src/server/parser';
import { executeQuery } from './src/server/queryEngine';
import { calculateComplexity } from './src/server/complexity';
import { findSimilarCodeBlocks } from './src/server/similarity';
import { TEMPLATES, COMMON_NODE_DESCRIPTIONS } from './src/server/templates';
import { MCP_TOOLS_METADATA, MCP_PROMPTS_METADATA, handleMCPToolCall, handleMCPPrompt } from './src/server/mcp';
import { ProjectIsolationError } from './src/server/isolation';
import { getProjectGitStatus, initProjectGitRepo } from './src/server/git';
import { importGitHubRepository, parseGitHubRepo } from './src/server/github';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const host = '0.0.0.0';

  // Secure CORS configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        if (process.env.NODE_ENV !== 'production') {
          return callback(null, true);
        }
        return callback(new Error(`Bloqueado por política CORS: Origem '${origin}' não autorizada.`));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '10mb' }));

  // API Key Authentication Middleware (Permissive when API_KEY is not defined in dev)
  const expectedApiKey = process.env.API_KEY;
  app.use((req, res, next) => {
    // Exclude health check, SSE stream, and non-api routes
    if (
      req.path === '/api/health' ||
      req.path === '/mcp/sse' ||
      !req.path.startsWith('/api/') ||
      !expectedApiKey
    ) {
      return next();
    }

    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];
    const token =
      apiKeyHeader ||
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null);

    if (!token || token !== expectedApiKey) {
      return res.status(401).json({
        error: 'Não autorizado',
        message: 'Chave de API inválida ou ausente. Forneça x-api-key ou Bearer token.',
      });
    }

    next();
  });

  // Health check with memory and runtime status
  app.get('/api/health', (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      status: 'ok',
      service: 'mcp-server-tree-sitter',
      version: '0.7.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: {
        rssMB: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMB: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMB: Math.round(memory.heapTotal / (1024 * 1024)),
      },
      environment: process.env.NODE_ENV || 'development',
    });
  });

  // Projects API
  app.get('/api/projects', (req, res) => {
    res.json(projectStore.listProjects());
  });

  app.get('/api/projects/overview', (req, res) => {
    res.json(projectStore.getProjectOverview());
  });

  app.get('/api/projects/:name/file-stats', (req, res) => {
    res.json(projectStore.getProjectFileStats(req.params.name));
  });

  // Git Status API for active project
  app.get('/api/projects/:name/git-status', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    const status = getProjectGitStatus(proj.path);
    res.json(status);
  });

  // Initialize Git in project directory
  app.post('/api/projects/:name/git-init', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    const status = initProjectGitRepo(proj.path);
    res.json(status);
  });

  app.post('/api/projects', (req, res) => {
    const { name, path, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const proj = projectStore.createProject(name, path, description);
    res.json({ status: 'created', project: proj.name, path: proj.path });
  });

  // Batch Create Project with Files (e.g. from local directory picker)
  app.post('/api/projects/batch-create', (req, res) => {
    try {
      const { name, path: dirPath, description, files } = req.body;
      if (!name) return res.status(400).json({ error: 'Project name is required' });
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'files must be a non-empty array' });
      }

      const finalPath = dirPath || `/workspace/${name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
      const proj = projectStore.createProject(name, finalPath, description || `Imported project ${name}`);

      const detectedLangs = new Set<string>();
      for (const f of files) {
        if (f.path && typeof f.content === 'string') {
          try {
            const saved = projectStore.saveFile(proj.name, f.path, f.content);
            detectedLangs.add(saved.language);
          } catch {
            // skip if path violates isolation
          }
        }
      }

      res.json({
        status: 'created',
        project: proj.name,
        path: proj.path,
        filesCount: proj.files.size,
        detectedLanguages: Array.from(detectedLangs),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Scan Local Directory on Host System
  app.post('/api/scan-directory', (req, res) => {
    try {
      const { path: dirPath, name: customName, maxFiles = 150 } = req.body;
      if (!dirPath) {
        return res.status(400).json({ error: 'Directory path is required' });
      }

      const normalizedPath = path.resolve(dirPath);

      // Security boundary check: prohibit path traversal outside allowed workspace
      const appRoot = path.resolve(process.cwd());
      const workspaceRoot = fs.existsSync('/workspace') ? path.resolve('/workspace') : appRoot;
      const isWithinApp = normalizedPath === appRoot || normalizedPath.startsWith(`${appRoot}${path.sep}`);
      const isWithinWorkspace = normalizedPath === workspaceRoot || normalizedPath.startsWith(`${workspaceRoot}${path.sep}`);

      if (!isWithinApp && !isWithinWorkspace) {
        return res.status(403).json({
          error: 'Acesso negado: O caminho solicitado está fora do workspace permitido (path traversal detectado).',
        });
      }

      if (!fs.existsSync(normalizedPath)) {
        return res.status(404).json({ error: `Directory does not exist: ${normalizedPath}` });
      }

      const stat = fs.statSync(normalizedPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: `Path is not a directory: ${normalizedPath}` });
      }

      const baseName = path.basename(normalizedPath) || 'scanned-project';
      const projectName = (customName || baseName).toLowerCase().replace(/[^a-z0-9_-]/g, '-');

      const IGNORE_DIRS = new Set([
        'node_modules',
        '.git',
        '.next',
        'dist',
        'build',
        '.venv',
        'venv',
        '__pycache__',
        '.turbo',
        '.cache',
        '.idea',
        '.vscode',
        '.ssh',
        '.aws',
        'coverage',
      ]);

      const ALLOWED_EXTS = new Set([
        '.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.java',
        '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
        '.json', '.yaml', '.yml', '.toml', '.md', '.sql', '.html', '.css'
      ]);

      const discoveredFiles: Array<{ relativePath: string; absolutePath: string; size: number }> = [];

      function walk(currentDir: string) {
        if (discoveredFiles.length >= maxFiles) return;
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (discoveredFiles.length >= maxFiles) break;
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            // Protect against reading secret/credential files
            if (
              entry.name.startsWith('.env') ||
              entry.name.includes('credential') ||
              entry.name.includes('id_rsa') ||
              entry.name.endsWith('.pem')
            ) {
              continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (ALLOWED_EXTS.has(ext)) {
              const rel = path.relative(normalizedPath, fullPath).replace(/\\/g, '/');
              try {
                const fileStat = fs.statSync(fullPath);
                if (fileStat.size <= 1024 * 1024) {
                  discoveredFiles.push({
                    relativePath: rel,
                    absolutePath: fullPath,
                    size: fileStat.size,
                  });
                }
              } catch {
                // skip
              }
            }
          }
        }
      }

      walk(normalizedPath);

      if (discoveredFiles.length === 0) {
        return res.status(400).json({
          error: `No supported source code files found in directory: ${normalizedPath}`,
        });
      }

      // Create isolated project
      const proj = projectStore.createProject(
        projectName,
        normalizedPath,
        `Project scanned from ${normalizedPath} (${discoveredFiles.length} files)`
      );

      // Save files into the isolated project
      const detectedLangs = new Set<string>();
      for (const item of discoveredFiles) {
        try {
          const content = fs.readFileSync(item.absolutePath, 'utf-8');
          const saved = projectStore.saveFile(proj.name, item.relativePath, content);
          detectedLangs.add(saved.language);
        } catch {
          // ignore unreadable files
        }
      }

      res.json({
        status: 'scanned',
        project: proj.name,
        path: proj.path,
        filesCount: proj.files.size,
        detectedLanguages: Array.from(detectedLangs),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import Project directly from GitHub
  app.post('/api/projects/import-github', async (req, res) => {
    try {
      const { repoUrl, branch, subpath, projectName: customName, token, maxFiles = 60 } = req.body;
      if (!repoUrl) {
        return res.status(400).json({ error: 'A URL ou identificador do repositório (owner/repo) é obrigatório.' });
      }

      const parsed = parseGitHubRepo(repoUrl);
      if (!parsed) {
        return res.status(400).json({ error: 'Formato de repositório inválido. Utilize "owner/repo" ou "https://github.com/owner/repo".' });
      }

      const result = await importGitHubRepository({
        repoUrl,
        branch,
        subpath,
        token,
        maxFiles: Number(maxFiles) || 60,
      });

      const baseName = result.repo.repo || 'github-project';
      const cleanProjName = (customName || baseName)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '') || 'github-project';

      const projPath = `/workspace/${cleanProjName}`;
      const description = result.repo.description
        ? `${result.repo.description} (GitHub: ${result.repo.owner}/${result.repo.repo}@${result.branch})`
        : `Repositório importado do GitHub: ${result.repo.owner}/${result.repo.repo}@${result.branch}`;

      // Create project in projectStore
      const proj = projectStore.createProject(cleanProjName, projPath, description);

      let savedCount = 0;
      const detectedLangs = new Set<string>();

      for (const file of result.files) {
        try {
          const saved = projectStore.saveFile(proj.name, file.path, file.content);
          detectedLangs.add(saved.language);
          savedCount++;
        } catch {
          // ignore path isolation conflicts
        }
      }

      res.json({
        status: 'imported',
        project: proj.name,
        path: proj.path,
        filesCount: savedCount,
        totalDiscovered: result.totalDiscovered,
        detectedLanguages: Array.from(detectedLangs),
        repoUrl: `https://github.com/${result.repo.owner}/${result.repo.repo}`,
        branch: result.branch,
        stars: result.repo.stars,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao importar repositório do GitHub.' });
    }
  });

  app.delete('/api/projects/:name', (req, res) => {
    const ok = projectStore.removeProject(req.params.name);
    if (!ok) return res.status(404).json({ error: 'Project not found' });
    res.json({ status: 'deleted', project: req.params.name });
  });

  // Files API
  app.get('/api/projects/:name/files', (req, res) => {
    try {
      const files = projectStore.listFiles(req.params.name);
      res.json(files);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:name/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
      const file = projectStore.getFile(req.params.name, filePath);
      if (!file) return res.status(404).json({ error: 'File not found' });
      res.json(file);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/projects/:name/file', (req, res) => {
    try {
      const { path, content } = req.body;
      if (!path) return res.status(400).json({ error: 'path is required' });
      const saved = projectStore.saveFile(req.params.name, path, content ?? '');
      res.json(saved);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/projects/:name/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
      const ok = projectStore.deleteFile(req.params.name, filePath);
      if (!ok) return res.status(404).json({ error: 'File not found' });
      res.json({ status: 'deleted', file: filePath });
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Project Isolation Audit Endpoint
  app.get('/api/projects/:name/isolation-audit', (req, res) => {
    const report = projectStore.auditIsolation(req.params.name);
    if (!report) return res.status(404).json({ error: 'Project not found' });
    res.json(report);
  });

  // AST endpoint
  app.post('/api/ast', (req, res) => {
    try {
      const { code, language, project, path } = req.body;
      let source = code;
      let lang = language;

      if (!source && project && path) {
        const f = projectStore.getFile(project, path);
        if (!f) return res.status(404).json({ error: 'File not found' });
        source = f.content;
        lang = f.language;
      }

      if (!source) source = '';
      if (!lang) lang = 'python';

      const ast = parseSourceToAST(source, lang);
      res.json(ast);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Export AST as downloadable JSON for external tools
  app.get('/api/projects/:name/ast-export', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
      const file = projectStore.getFile(req.params.name, filePath);
      if (!file) return res.status(404).json({ error: 'File not found' });

      const ast = parseSourceToAST(file.content, file.language);
      const filename = filePath.split('/').pop() || 'file';
      const cleanFilename = `${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}.ast.json`;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
      res.json({
        $schema: 'https://tree-sitter.github.io/schema/ast.json',
        project: req.params.name,
        filePath,
        language: file.language,
        exportedAt: new Date().toISOString(),
        version: '0.7.0',
        ast,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Query endpoint
  app.post('/api/query', (req, res) => {
    try {
      const { query, code, language, captureFilter, maxResults, project, path } = req.body;
      if (!query) return res.status(400).json({ error: 'Query is required' });

      let source = code;
      let lang = language;

      if (!source && project && path) {
        const f = projectStore.getFile(project, path);
        if (!f) return res.status(404).json({ error: 'File not found' });
        source = f.content;
        lang = f.language;
      }

      const ast = parseSourceToAST(source || '', lang || 'python');
      const matches = executeQuery(ast, query, {
        captureFilter,
        maxResults: maxResults ? Number(maxResults) : 100,
      });
      res.json(matches);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Symbols endpoint
  app.post('/api/symbols', (req, res) => {
    try {
      const { code, language, project, path } = req.body;
      let source = code;
      let lang = language || 'python';

      if (!source && project && path) {
        const f = projectStore.getFile(project, path);
        if (!f) return res.status(404).json({ error: 'File not found' });
        source = f.content;
        lang = f.language;
      }

      const ast = parseSourceToAST(source || '', lang);
      const symbols = extractSymbolsFromAST(ast, lang);
      res.json(symbols);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Complexity endpoint
  app.post('/api/complexity', (req, res) => {
    try {
      const { code, language, project, path } = req.body;
      let source = code;
      let lang = language || 'python';

      if (!source && project && path) {
        const f = projectStore.getFile(project, path);
        if (!f) return res.status(404).json({ error: 'File not found' });
        source = f.content;
        lang = f.language;
      }

      const ast = parseSourceToAST(source || '', lang);
      const metrics = calculateComplexity(source || '', ast);
      res.json(metrics);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Node at position
  app.post('/api/node-at-pos', (req, res) => {
    try {
      const { code, language, row, column, project, path } = req.body;
      let source = code;
      let lang = language || 'python';

      if (!source && project && path) {
        const f = projectStore.getFile(project, path);
        if (!f) return res.status(404).json({ error: 'File not found' });
        source = f.content;
        lang = f.language;
      }

      const ast = parseSourceToAST(source || '', lang);
      const node = findNodeAtPosition(ast, Number(row), Number(column));
      res.json(node || null);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Similarity endpoint
  app.post('/api/similarity', (req, res) => {
    try {
      const { snippet, language, project, threshold, maxResults } = req.body;
      const proj = projectStore.getProject(project || 'tree-sitter-core');
      const candidates = proj
        ? Array.from(proj.files.values()).map((f) => ({
            path: f.path,
            content: f.content,
            language: f.language,
          }))
        : [];

      const results = findSimilarCodeBlocks(
        snippet || '',
        language || 'python',
        candidates,
        Number(threshold || 0.5),
        Number(maxResults || 10)
      );
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Query templates endpoint
  app.get('/api/templates', (req, res) => {
    const lang = req.query.language as string;
    if (lang && TEMPLATES[lang]) {
      return res.json(TEMPLATES[lang]);
    }
    res.json(TEMPLATES);
  });

  // Languages endpoint
  app.get('/api/languages', (req, res) => {
    res.json({
      available: Object.keys(TEMPLATES),
      descriptions: COMMON_NODE_DESCRIPTIONS,
    });
  });

  // Full Model Context Protocol (MCP) JSON-RPC 2.0 Handler
  app.post('/api/mcp', async (req, res) => {
    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
      });
    }

    try {
      switch (method) {
        case 'initialize': {
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: { listChanged: false },
                prompts: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
              },
              serverInfo: {
                name: 'mcp-server-tree-sitter',
                version: '0.7.0',
              },
            },
          });
        }

        case 'tools/list': {
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              tools: MCP_TOOLS_METADATA,
            },
          });
        }

        case 'tools/call': {
          const { name, arguments: toolArgs } = params || {};
          if (!name) {
            return res.json({
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Missing tool name parameter' },
            });
          }
          const toolResult = await handleMCPToolCall(name, toolArgs || {});
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2),
                },
              ],
            },
          });
        }

        case 'prompts/list': {
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              prompts: MCP_PROMPTS_METADATA,
            },
          });
        }

        case 'prompts/get': {
          const { name, arguments: promptArgs } = params || {};
          const text = handleMCPPrompt(name, promptArgs || {});
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              description: `Generated prompt for ${name}`,
              messages: [
                {
                  role: 'user',
                  content: {
                    type: 'text',
                    text,
                  },
                },
              ],
            },
          });
        }

        case 'resources/list': {
          const projs = projectStore.listProjects();
          const resources = projs.flatMap((p) =>
            projectStore.listFiles(p.name).map((f) => ({
              uri: `file://${p.path}/${f}`,
              name: `${p.name}/${f}`,
              mimeType: 'text/plain',
            }))
          );
          return res.json({
            jsonrpc: '2.0',
            id,
            result: { resources },
          });
        }

        default:
          return res.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
      }
    } catch (error: any) {
      return res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error.message || 'Internal error' },
      });
    }
  });

  const activeSseClients = new Set<express.Response>();

  // Server-Sent Events (SSE) MCP Stream
  app.get('/mcp/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    activeSseClients.add(res);

    const endpointMsg = JSON.stringify({ endpoint: '/api/mcp' });
    res.write(`event: endpoint\ndata: ${endpointMsg}\n\n`);

    const interval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(interval);
      activeSseClients.delete(res);
    });
  });

  // Vite development middleware
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  const server = app.listen(port, host, () => {
    console.log(`[MCP Tree-sitter] Server running at http://${host}:${port}`);
    console.log(`[MCP Tree-sitter] MCP JSON-RPC available at http://${host}:${port}/api/mcp`);
    console.log(`[MCP Tree-sitter] MCP SSE Stream available at http://${host}:${port}/mcp/sse`);
  });

  // Graceful shutdown handling
  let isShuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[MCP Tree-sitter] Recebido ${signal}. Encerrando conexões graciosamente...`);

    // Notify and close SSE clients
    for (const client of activeSseClients) {
      try {
        client.write('event: shutdown\ndata: {"status":"shutting_down"}\n\n');
        client.end();
      } catch {}
    }
    activeSseClients.clear();

    server.close(() => {
      console.log('[MCP Tree-sitter] Servidor HTTP encerrado com sucesso.');
      process.exit(0);
    });

    // Fallback force shutdown after 10 seconds
    setTimeout(() => {
      console.error('[MCP Tree-sitter] Timeout excedido no encerramento gracioso. Forçando saída.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
