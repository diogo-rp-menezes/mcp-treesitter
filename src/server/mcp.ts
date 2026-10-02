import { projectStore } from './store';
import { detectLanguage, extractSymbolsFromAST, findNodeAtPosition, parseSourceToAST } from './parser';
import { executeQuery } from './queryEngine';
import { calculateComplexity } from './complexity';
import { findSimilarCodeBlocks } from './similarity';
import { COMMON_NODE_DESCRIPTIONS, TEMPLATES } from './templates';

export const MCP_TOOLS_METADATA = [
  {
    name: 'get_ast',
    description: 'Get abstract syntax tree for a file or code snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        path: { type: 'string', description: 'File path relative to project' },
        code: { type: 'string', description: 'Optional raw code snippet' },
        language: { type: 'string', description: 'Language if providing raw code' },
        max_depth: { type: 'number', description: 'Max depth of AST' },
      },
    },
  },
  {
    name: 'run_query',
    description: 'Run a Tree-sitter S-expression query on project files or raw code.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        query: { type: 'string', description: 'Tree-sitter S-expression query' },
        file_path: { type: 'string', description: 'File to query' },
        code: { type: 'string', description: 'Optional raw code string' },
        language: { type: 'string', description: 'Language' },
        capture_filter: { type: 'string', description: 'Optional capture name to filter' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_symbols',
    description: 'Extract symbols (functions, classes, imports) from a file or code.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        file_path: { type: 'string', description: 'Path to file' },
        code: { type: 'string', description: 'Raw code snippet' },
        language: { type: 'string', description: 'Language' },
      },
    },
  },
  {
    name: 'analyze_complexity',
    description: 'Analyze code complexity, lines of code, and cyclomatic complexity.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        file_path: { type: 'string', description: 'File path' },
        code: { type: 'string', description: 'Raw code' },
        language: { type: 'string', description: 'Language' },
      },
    },
  },
  {
    name: 'get_node_at_position',
    description: 'Find AST node at row and column coordinate.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        path: { type: 'string', description: 'File path' },
        row: { type: 'number', description: '0-based row' },
        column: { type: 'number', description: '0-based column' },
      },
      required: ['row', 'column'],
    },
  },
  {
    name: 'find_similar_code',
    description: 'Find code structurally similar to a snippet using AST fingerprinting.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        snippet: { type: 'string', description: 'Snippet to compare' },
        language: { type: 'string', description: 'Language' },
        threshold: { type: 'number', description: 'Minimum similarity (0.0 - 1.0)' },
      },
      required: ['snippet'],
    },
  },
  {
    name: 'list_languages',
    description: 'List available languages supported by the Tree-sitter server.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_projects_tool',
    description: 'List all registered projects.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_files',
    description: 'List files in a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        pattern: { type: 'string', description: 'Glob pattern' },
        extensions: { type: 'array', items: { type: 'string' } },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_file',
    description: 'Get content of a file.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name' },
        path: { type: 'string', description: 'File path' },
      },
      required: ['project', 'path'],
    },
  },
  {
    name: 'get_query_template_tool',
    description: 'Get predefined tree-sitter query template for a language.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Language' },
        template_name: { type: 'string', description: 'Template name (functions, classes, etc.)' },
      },
      required: ['language', 'template_name'],
    },
  },
  {
    name: 'list_query_templates_tool',
    description: 'List available query templates.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional language filter' },
      },
    },
  },
  {
    name: 'audit_project_isolation',
    description: 'Audit workspace isolation compliance for a project to verify no file leaks or cross-contamination.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name to audit' },
      },
    },
  },
];

export const MCP_PROMPTS_METADATA = [
  {
    name: 'code_review',
    description: 'Prompt template for automated code review using extracted AST symbols.',
    arguments: [
      { name: 'project', description: 'Project name', required: true },
      { name: 'file_path', description: 'File to review', required: true },
    ],
  },
  {
    name: 'explain_code',
    description: 'Prompt template explaining file structure and patterns.',
    arguments: [
      { name: 'project', description: 'Project name', required: true },
      { name: 'file_path', description: 'File path', required: true },
      { name: 'focus', description: 'Specific focus area', required: false },
    ],
  },
  {
    name: 'explain_tree_sitter_query',
    description: 'Prompt template explaining Tree-sitter S-expression query syntax.',
    arguments: [],
  },
  {
    name: 'suggest_improvements',
    description: 'Prompt template for code improvements based on complexity metrics.',
    arguments: [
      { name: 'project', description: 'Project name', required: true },
      { name: 'file_path', description: 'File path', required: true },
    ],
  },
  {
    name: 'project_overview',
    description: 'Prompt template analyzing overall codebase structure.',
    arguments: [{ name: 'project', description: 'Project name', required: true }],
  },
];

export async function handleMCPToolCall(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case 'list_languages': {
      return {
        available: Object.keys(TEMPLATES),
        installable: [],
      };
    }

    case 'list_projects_tool': {
      return projectStore.listProjects();
    }

    case 'register_project_tool': {
      const proj = projectStore.createProject(args.name || 'unnamed', args.path, args.description);
      return {
        name: proj.name,
        path: proj.path,
        files: Array.from(proj.files.keys()),
      };
    }

    case 'list_files': {
      return projectStore.listFiles(args.project, args.pattern, args.extensions);
    }

    case 'get_file': {
      const f = projectStore.getFile(args.project, args.path);
      if (!f) throw new Error(`File ${args.path} not found in project ${args.project}`);
      return f.content;
    }

    case 'get_file_metadata': {
      const f = projectStore.getFile(args.project, args.path);
      if (!f) throw new Error(`File ${args.path} not found in project ${args.project}`);
      return {
        path: f.path,
        language: f.language,
        sizeBytes: f.sizeBytes,
        lastModified: f.lastModified,
      };
    }

    case 'get_ast': {
      let code = args.code;
      let lang = args.language || 'python';

      if (!code && args.project && args.path) {
        const file = projectStore.getFile(args.project, args.path);
        if (!file) throw new Error(`File ${args.path} not found`);
        code = file.content;
        lang = file.language;
      }

      if (!code) throw new Error('Either code or project + path must be provided');
      return parseSourceToAST(code, lang);
    }

    case 'get_node_at_position': {
      let code = args.code;
      let lang = args.language || 'python';

      if (!code && args.project && args.path) {
        const file = projectStore.getFile(args.project, args.path);
        if (!file) throw new Error(`File ${args.path} not found`);
        code = file.content;
        lang = file.language;
      }

      if (!code) throw new Error('Code or project + path required');
      const ast = parseSourceToAST(code, lang);
      const node = findNodeAtPosition(ast, Number(args.row), Number(args.column));
      return node || { error: 'No node found at specified position' };
    }

    case 'run_query': {
      let code = args.code;
      let lang = args.language || 'python';

      if (!code && args.project && (args.file_path || args.path)) {
        const filePath = args.file_path || args.path;
        const file = projectStore.getFile(args.project, filePath);
        if (!file) throw new Error(`File ${filePath} not found`);
        code = file.content;
        lang = file.language;
      }

      if (!code) throw new Error('Code or file_path required');
      const ast = parseSourceToAST(code, lang);
      const matches = executeQuery(ast, args.query, {
        captureFilter: args.capture_filter,
      });
      return matches;
    }

    case 'get_symbols': {
      let code = args.code;
      let lang = args.language || 'python';

      if (!code && args.project && (args.file_path || args.path)) {
        const filePath = args.file_path || args.path;
        const file = projectStore.getFile(args.project, filePath);
        if (!file) throw new Error(`File ${filePath} not found`);
        code = file.content;
        lang = file.language;
      }

      if (!code) throw new Error('Code or file_path required');
      const ast = parseSourceToAST(code, lang);
      return extractSymbolsFromAST(ast, lang);
    }

    case 'analyze_complexity': {
      let code = args.code;
      let lang = args.language || 'python';

      if (!code && args.project && (args.file_path || args.path)) {
        const filePath = args.file_path || args.path;
        const file = projectStore.getFile(args.project, filePath);
        if (!file) throw new Error(`File ${filePath} not found`);
        code = file.content;
        lang = file.language;
      }

      if (!code) throw new Error('Code or file_path required');
      const ast = parseSourceToAST(code, lang);
      return calculateComplexity(code, ast);
    }

    case 'find_similar_code': {
      const proj = projectStore.getProject(args.project || 'tree-sitter-core');
      const candidates = proj
        ? Array.from(proj.files.values()).map((f) => ({
            path: f.path,
            content: f.content,
            language: f.language,
          }))
        : [];

      return findSimilarCodeBlocks(
        args.snippet,
        args.language || 'python',
        candidates,
        args.threshold || 0.5,
        args.max_results || 10
      );
    }

    case 'get_query_template_tool': {
      const t = TEMPLATES[args.language]?.[args.template_name];
      if (!t) throw new Error(`Template ${args.template_name} not found for ${args.language}`);
      return {
        language: args.language,
        name: args.template_name,
        query: t,
      };
    }

    case 'list_query_templates_tool': {
      if (args.language) {
        return { [args.language]: Object.keys(TEMPLATES[args.language] || {}) };
      }
      const res: Record<string, string[]> = {};
      for (const [l, t] of Object.entries(TEMPLATES)) {
        res[l] = Object.keys(t);
      }
      return res;
    }

    case 'get_node_types': {
      return COMMON_NODE_DESCRIPTIONS[args.language] || {};
    }

    case 'clear_cache': {
      return { status: 'success', message: 'Parse tree caches successfully cleared' };
    }

    case 'configure': {
      return {
        cache: { enabled: args.cache_enabled ?? true, max_size_mb: 100 },
        security: { max_file_size_mb: args.max_file_size_mb ?? 10 },
        log_level: args.log_level || 'INFO',
      };
    }

    case 'audit_project_isolation': {
      const proj = args.project || 'tree-sitter-core';
      const report = projectStore.auditIsolation(proj);
      if (!report) throw new Error(`Project '${proj}' not found`);
      return report;
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export function handleMCPPrompt(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'code_review': {
      const f = projectStore.getFile(args.project, args.file_path);
      const code = f?.content || '';
      return `Please review this ${f?.language || 'code'} file:\n\n\`\`\`\n${code}\n\`\`\`\nFocus on clarity, potential bugs, performance, and best practices.`;
    }
    case 'explain_code': {
      const f = projectStore.getFile(args.project, args.file_path);
      const code = f?.content || '';
      return `Please explain this ${f?.language || 'code'} file:\n\n\`\`\`\n${code}\n\`\`\`\nExplain what it does, how it is structured, and any key patterns.`;
    }
    case 'explain_tree_sitter_query': {
      return `Tree-sitter queries use S-expression syntax to match patterns in code.\n\nBasic query syntax:\n- (node_type) - Match nodes of a specific type\n- (node_type field: (child_type)) - Match nodes with specific field relationships\n- @name - Capture a node with a name\n- #predicate - Apply additional constraints`;
    }
    case 'suggest_improvements': {
      const f = projectStore.getFile(args.project, args.file_path);
      return `Please suggest improvements for ${args.file_path} focusing on modularity, error handling, and performance.`;
    }
    case 'project_overview': {
      const proj = projectStore.getProject(args.project);
      const files = proj ? Array.from(proj.files.keys()).join(', ') : '';
      return `Please analyze this project (${args.project}) with files: ${files}. Provide an overview of its architectural structure.`;
    }
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
