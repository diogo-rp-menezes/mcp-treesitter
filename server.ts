import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { projectStore } from './src/server/store';
import {
  parseSourceToAST,
  parseSourceToASTAsync,
  detectLanguage,
  extractSymbolsFromAST,
  findNodeAtPosition,
} from './src/server/parser';
import { initTreeSitter } from './src/server/treeSitter';
import { executeQuery } from './src/server/queryEngine';
import { calculateComplexity } from './src/server/complexity';
import { findSimilarCodeBlocks } from './src/server/similarity';
import { TEMPLATES, COMMON_NODE_DESCRIPTIONS } from './src/server/templates';
import { languageRegistry } from './src/server/languageRegistry';
import { treeCache } from './src/server/treeCache';
import {
  analyzeProjectStructure,
  findDependencies,
  searchText,
} from './src/server/operations';
import { adaptQuery, buildCompoundQuery } from './src/server/queryBuilder';
import { MCPTreeSitterError } from './src/server/errors';
import { MCP_TOOLS_METADATA, MCP_PROMPTS_METADATA, handleMCPToolCall, handleMCPPrompt } from './src/server/mcp';
import { ProjectIsolationError } from './src/server/isolation';
import {
  getProjectGitStatus,
  initProjectGitRepo,
  stageGitFiles,
  unstageGitFiles,
  commitGitChanges,
  switchGitBranch,
  syncProjectFilesToDisk,
} from './src/server/git';
import { importGitHubRepository, parseGitHubRepo } from './src/server/github';
import { sqliteStorage } from './src/server/db';

async function startServer() {
  // Initialize WebAssembly Tree-sitter runtime and preload core language grammars
  try {
    await initTreeSitter();
  } catch (err: any) {
    console.warn(`[Tree-sitter WASM] Initialization warning: ${err?.message}`);
  }

  const app = express();
  const port = Number(process.env.PORT || 3000);
  const host = '0.0.0.0';

  // Secure CORS configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

  app.use(
    cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
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
    try {
      // Sync files to disk first so git tracks them
      const files = Array.from(proj.files.values()).map((f) => ({ path: f.path, content: f.content }));
      syncProjectFilesToDisk(proj.path, files);
      const status = initProjectGitRepo(proj.path);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sync SQLite project files to disk directory
  app.post('/api/projects/:name/git-sync', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    try {
      const files = Array.from(proj.files.values()).map((f) => ({ path: f.path, content: f.content }));
      const result = syncProjectFilesToDisk(proj.path, files);
      const status = getProjectGitStatus(proj.path);
      res.json({ ...result, gitStatus: status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stage files for Git commit
  app.post('/api/projects/:name/git-stage', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    try {
      const { files } = req.body;
      const status = stageGitFiles(proj.path, files);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unstage files
  app.post('/api/projects/:name/git-unstage', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    try {
      const { files } = req.body;
      const status = unstageGitFiles(proj.path, files);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Commit changes
  app.post('/api/projects/:name/git-commit', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Mensagem de commit é obrigatória.' });
      const status = commitGitChanges(proj.path, message);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Switch or create branch
  app.post('/api/projects/:name/git-branch', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    try {
      const { branch, create } = req.body;
      if (!branch) return res.status(400).json({ error: 'Nome da branch é obrigatório.' });
      const status = switchGitBranch(proj.path, branch, Boolean(create));
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export full project bundle as JSON
  app.get('/api/projects/:name/export', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Project not found' });

    const bundle = {
      name: proj.name,
      path: proj.path,
      description: proj.description,
      exportedAt: new Date().toISOString(),
      filesCount: proj.files.size,
      files: Array.from(proj.files.values()).map((f) => ({
        path: f.path,
        language: f.language,
        sizeBytes: f.sizeBytes,
        lastModified: f.lastModified,
        content: f.content,
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${proj.name}-export.json"`);
    res.json(bundle);
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

  // Import Project directly from GitHub with streaming buffer system
  app.post('/api/projects/import-github', async (req, res) => {
    try {
      const { repoUrl, branch, subpath, projectName: customName, token, maxFiles } = req.body;
      if (!repoUrl) {
        return res.status(400).json({ error: 'A URL ou identificador do repositório (owner/repo) é obrigatório.' });
      }

      const parsed = parseGitHubRepo(repoUrl);
      if (!parsed) {
        return res.status(400).json({ error: 'Formato de repositório inválido. Utilize "owner/repo" ou "https://github.com/owner/repo".' });
      }

      const cleanProjName = (customName || parsed.repo)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '') || 'github-project';

      const projPath = `/workspace/${cleanProjName}`;

      let createdProj = projectStore.getProject(cleanProjName);
      if (!createdProj) {
        createdProj = projectStore.createProject(
          cleanProjName,
          projPath,
          `Repositório importado do GitHub: ${parsed.owner}/${parsed.repo}`
        );
      }

      let savedCount = 0;
      const detectedLangs = new Set<string>();

      // Import with streaming buffer: files are persisted in batches as they stream in
      const result = await importGitHubRepository({
        repoUrl,
        branch,
        subpath,
        token,
        maxFiles: typeof maxFiles === 'number' && maxFiles > 0 ? maxFiles : 0, // 0 = unlimited
        batchSize: 25,
        onBatch: (batch) => {
          projectStore.saveFilesBatch(
            cleanProjName,
            batch.map((f) => ({ path: f.path, content: f.content }))
          );
          for (const f of batch) {
            detectedLangs.add(f.language);
          }
          savedCount += batch.length;
        },
      });

      // Update project description with stars and branch
      if (result.repo.description) {
        createdProj.description = `${result.repo.description} (GitHub: ${result.repo.owner}/${result.repo.repo}@${result.branch})`;
      }

      res.json({
        status: 'imported',
        project: cleanProjName,
        path: projPath,
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

  // Get single project details (Read)
  app.get('/api/projects/:name', (req, res) => {
    const proj = projectStore.getProject(req.params.name);
    if (!proj) return res.status(404).json({ error: 'Projeto não encontrado' });
    res.json({
      name: proj.name,
      path: proj.path,
      description: proj.description,
      filesCount: proj.files.size,
      files: Array.from(proj.files.keys()),
    });
  });

  // Update project metadata (Update)
  app.put('/api/projects/:name', (req, res) => {
    try {
      const { name, path: projPath, description } = req.body;
      const updated = projectStore.updateProject(req.params.name, {
        name,
        path: projPath,
        description,
      });
      res.json({
        status: 'updated',
        project: updated.name,
        path: updated.path,
        description: updated.description,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/projects/:name', (req, res) => {
    try {
      const { name, path: projPath, description } = req.body;
      const updated = projectStore.updateProject(req.params.name, {
        name,
        path: projPath,
        description,
      });
      res.json({
        status: 'updated',
        project: updated.name,
        path: updated.path,
        description: updated.description,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clone project (Clone)
  app.post('/api/projects/:name/clone', (req, res) => {
    try {
      const { targetName, targetPath, targetDescription } = req.body;
      if (!targetName) {
        return res.status(400).json({ error: 'O nome do novo projeto (targetName) é obrigatório.' });
      }
      const cloned = projectStore.cloneProject(
        req.params.name,
        targetName,
        targetPath,
        targetDescription
      );
      res.json({
        status: 'cloned',
        project: cloned.name,
        path: cloned.path,
        description: cloned.description,
        filesCount: cloned.files.size,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/projects/:name', (req, res) => {
    const ok = projectStore.removeProject(req.params.name);
    if (!ok) return res.status(404).json({ error: 'Project not found' });
    res.json({ status: 'deleted', project: req.params.name });
  });

  // SQLite Database Explorer API
  app.get('/api/database/schema', (_req, res) => {
    try {
      const schema = sqliteStorage.getDatabaseSchema();
      res.json(schema);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao inspecionar o esquema do banco de dados.' });
    }
  });

  app.get('/api/database/table/:name', (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const data = sqliteStorage.getTableRecords(req.params.name, limit, offset);
      res.json(data);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/database/query', (req, res) => {
    try {
      const { sql } = req.body;
      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ error: 'Parâmetro SQL é obrigatório e deve ser uma string.' });
      }
      const result = sqliteStorage.executeRawQuery(sql);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Erro na execução da consulta SQL.' });
    }
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
  app.post('/api/ast', async (req, res) => {
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

      const ast = await parseSourceToASTAsync(source, lang);
      res.json(ast);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Export AST as downloadable JSON for external tools
  app.get('/api/projects/:name/ast-export', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
      const file = projectStore.getFile(req.params.name, filePath);
      if (!file) return res.status(404).json({ error: 'File not found' });

      const ast = await parseSourceToASTAsync(file.content, file.language);
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
  app.post('/api/query', async (req, res) => {
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

      const ast = await parseSourceToASTAsync(source || '', lang || 'python');
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
  app.post('/api/symbols', async (req, res) => {
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

      const ast = await parseSourceToASTAsync(source || '', lang);
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
  app.post('/api/complexity', async (req, res) => {
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

      const ast = await parseSourceToASTAsync(source || '', lang);
      const metrics = calculateComplexity(source || '', ast, lang);
      res.json(metrics);
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Consolidated real-time analysis endpoint to minimize network overhead and avoid throttling
  app.post('/api/analyze', async (req, res) => {
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

      const ast = await parseSourceToASTAsync(source || '', lang);
      const symbols = extractSymbolsFromAST(ast, lang);
      const complexity = calculateComplexity(source || '', ast, lang);

      res.json({
        ast,
        symbols,
        complexity,
      });
    } catch (err: any) {
      if (err instanceof ProjectIsolationError) {
        return res.status(403).json({ error: 'Project Isolation Violation', message: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Node at position
  app.post('/api/node-at-pos', async (req, res) => {
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

      const ast = await parseSourceToASTAsync(source || '', lang);
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
      available: languageRegistry.listAvailableLanguages(),
      installable: languageRegistry.listInstallableLanguages(),
      descriptions: COMMON_NODE_DESCRIPTIONS,
    });
  });

  // Project structure endpoint
  app.get('/api/projects/:name/structure', (req, res) => {
    try {
      const proj = projectStore.getProject(req.params.name);
      if (!proj) return res.status(404).json({ error: 'Project not found' });
      const analysis = analyzeProjectStructure(proj, languageRegistry, Number(req.query.scan_depth || 3));
      res.json(analysis);
    } catch (err: any) {
      if (err instanceof MCPTreeSitterError) {
        return res.status(err.statusCode).json(err.toJSON());
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Dependencies endpoint
  app.get('/api/projects/:name/dependencies', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
      const proj = projectStore.getProject(req.params.name);
      if (!proj) return res.status(404).json({ error: 'Project not found' });
      const deps = await findDependencies(proj, filePath, languageRegistry);
      res.json(deps);
    } catch (err: any) {
      if (err instanceof MCPTreeSitterError) {
        return res.status(err.statusCode).json(err.toJSON());
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Text search endpoint
  app.post('/api/projects/:name/search-text', (req, res) => {
    try {
      const { pattern, filePattern, maxResults, caseSensitive, wholeWord, useRegex, contextLines } = req.body;
      if (!pattern) return res.status(400).json({ error: 'pattern is required' });
      const proj = projectStore.getProject(req.params.name);
      if (!proj) return res.status(404).json({ error: 'Project not found' });
      const results = searchText(
        proj,
        pattern,
        filePattern || '**/*',
        maxResults ? Number(maxResults) : 100,
        Boolean(caseSensitive),
        Boolean(wholeWord),
        Boolean(useRegex),
        contextLines ? Number(contextLines) : 0
      );
      res.json(results);
    } catch (err: any) {
      if (err instanceof MCPTreeSitterError) {
        return res.status(err.statusCode).json(err.toJSON());
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Query adaptation endpoint
  app.post('/api/query/adapt', (req, res) => {
    try {
      const { query, fromLanguage, toLanguage } = req.body;
      if (!query || !fromLanguage || !toLanguage) {
        return res.status(400).json({ error: 'query, fromLanguage and toLanguage are required' });
      }
      res.json(adaptQuery(query, fromLanguage, toLanguage));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Compound query endpoint
  app.post('/api/query/compound', (req, res) => {
    try {
      const { language, patterns, combine } = req.body;
      if (!language || !patterns || !Array.isArray(patterns)) {
        return res.status(400).json({ error: 'language and patterns array are required' });
      }
      res.json({
        query: buildCompoundQuery(language, patterns, combine || 'or'),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cache stats endpoint
  app.get('/api/cache/stats', (req, res) => {
    res.json(treeCache.getStats());
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
              uri: `file://${p.path.startsWith('/') ? '' : '/'}${p.path}/${f}`,
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

        case 'resources/read': {
          const { uri } = params || {};
          if (!uri || typeof uri !== 'string') {
            return res.json({
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Missing or invalid uri parameter in resources/read' },
            });
          }

          const projs = projectStore.listProjects();
          let matchedContent: string | null = null;
          let matchedMimeType = 'text/plain';

          for (const p of projs) {
            const files = projectStore.listFiles(p.name);
            for (const f of files) {
              const fileUri = `file://${p.path.startsWith('/') ? '' : '/'}${p.path}/${f}`;
              if (uri === fileUri || uri.endsWith(`/${f}`) || uri.includes(`${p.name}/${f}`)) {
                const fileObj = projectStore.getFile(p.name, f);
                if (fileObj) {
                  matchedContent = fileObj.content;
                  break;
                }
              }
            }
            if (matchedContent !== null) break;
          }

          if (matchedContent === null) {
            return res.json({
              jsonrpc: '2.0',
              id,
              error: { code: -32002, message: `Resource not found for uri: ${uri}` },
            });
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: matchedMimeType,
                  text: matchedContent,
                },
              ],
            },
          });
        }

        case 'ping': {
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {},
          });
        }

        case 'notifications/initialized': {
          // MCP notification, no response required or return empty ok
          return res.json({
            jsonrpc: '2.0',
            id: id ?? null,
            result: { status: 'acknowledged' },
          });
        }

        case 'roots/list': {
          const projs = projectStore.listProjects();
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              roots: projs.map((p) => ({
                uri: `file://${p.path.startsWith('/') ? '' : '/'}${p.path}`,
                name: p.name,
              })),
            },
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
