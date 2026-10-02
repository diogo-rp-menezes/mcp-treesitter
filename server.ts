import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { projectStore } from './src/server/store';
import { parseSourceToAST, detectLanguage, extractSymbolsFromAST, findNodeAtPosition } from './src/server/parser';
import { executeQuery } from './src/server/queryEngine';
import { calculateComplexity } from './src/server/complexity';
import { findSimilarCodeBlocks } from './src/server/similarity';
import { TEMPLATES, COMMON_NODE_DESCRIPTIONS } from './src/server/templates';
import { MCP_TOOLS_METADATA, MCP_PROMPTS_METADATA, handleMCPToolCall, handleMCPPrompt } from './src/server/mcp';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const host = '0.0.0.0';

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'mcp-server-tree-sitter',
      version: '0.7.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Projects API
  app.get('/api/projects', (req, res) => {
    res.json(projectStore.listProjects());
  });

  app.post('/api/projects', (req, res) => {
    const { name, path, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const proj = projectStore.createProject(name, path, description);
    res.json({ status: 'created', project: proj.name });
  });

  app.delete('/api/projects/:name', (req, res) => {
    const ok = projectStore.removeProject(req.params.name);
    if (!ok) return res.status(404).json({ error: 'Project not found' });
    res.json({ status: 'deleted', project: req.params.name });
  });

  // Files API
  app.get('/api/projects/:name/files', (req, res) => {
    const files = projectStore.listFiles(req.params.name);
    res.json(files);
  });

  app.get('/api/projects/:name/file', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
    const file = projectStore.getFile(req.params.name, filePath);
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.json(file);
  });

  app.post('/api/projects/:name/file', (req, res) => {
    const { path, content } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });
    const saved = projectStore.saveFile(req.params.name, path, content ?? '');
    res.json(saved);
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
      res.status(500).json({ error: err.message });
    }
  });

  // Query endpoint
  app.post('/api/query', (req, res) => {
    try {
      const { query, code, language, captureFilter, maxResults } = req.body;
      if (!query) return res.status(400).json({ error: 'Query is required' });
      const ast = parseSourceToAST(code || '', language || 'python');
      const matches = executeQuery(ast, query, {
        captureFilter,
        maxResults: maxResults ? Number(maxResults) : 100,
      });
      res.json(matches);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Symbols endpoint
  app.post('/api/symbols', (req, res) => {
    try {
      const { code, language } = req.body;
      const lang = language || 'python';
      const ast = parseSourceToAST(code || '', lang);
      const symbols = extractSymbolsFromAST(ast, lang);
      res.json(symbols);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Complexity endpoint
  app.post('/api/complexity', (req, res) => {
    try {
      const { code, language } = req.body;
      const lang = language || 'python';
      const ast = parseSourceToAST(code || '', lang);
      const metrics = calculateComplexity(code || '', ast);
      res.json(metrics);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Node at position
  app.post('/api/node-at-pos', (req, res) => {
    try {
      const { code, language, row, column } = req.body;
      const ast = parseSourceToAST(code || '', language || 'python');
      const node = findNodeAtPosition(ast, Number(row), Number(column));
      res.json(node || null);
    } catch (err: any) {
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

  // Server-Sent Events (SSE) MCP Stream
  app.get('/mcp/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const endpointMsg = JSON.stringify({ endpoint: '/api/mcp' });
    res.write(`event: endpoint\ndata: ${endpointMsg}\n\n`);

    const interval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(interval);
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

  app.listen(port, host, () => {
    console.log(`[MCP Tree-sitter] Server running at http://${host}:${port}`);
    console.log(`[MCP Tree-sitter] MCP JSON-RPC available at http://${host}:${port}/api/mcp`);
    console.log(`[MCP Tree-sitter] MCP SSE Stream available at http://${host}:${port}/mcp/sse`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
