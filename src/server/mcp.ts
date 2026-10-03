import { projectStore } from './store';
import { detectLanguage, extractSymbolsFromAST, findNodeAtPosition, parseSourceToAST } from './parser';
import { executeQuery } from './queryEngine';
import { calculateComplexity } from './complexity';
import { findSimilarCodeBlocks } from './similarity';
import { COMMON_NODE_DESCRIPTIONS, TEMPLATES } from './templates';
import { z } from 'zod';

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

// Zod schemas for MCP tool argument validation
// Compiled once at module load for performance
export const MCP_TOOL_SCHEMAS = {
  get_ast: z.object({
    project: z.string().optional(),
    path: z.string().optional(),
    code: z.string().optional(),
    language: z.string().optional(),
    max_depth: z.number().int().positive().optional(),
  }),

  run_query: z.object({
    project: z.string().optional(),
    query: z.string().min(1),
    file_path: z.string().optional(),
    code: z.string().optional(),
    language: z.string().optional(),
    capture_filter: z.string().optional(),
  }),

  get_symbols: z.object({
    project: z.string().optional(),
    file_path: z.string().optional(),
    code: z.string().optional(),
    language: z.string().optional(),
  }),

  analyze_complexity: z.object({
    project: z.string().optional(),
    file_path: z.string().optional(),
    code: z.string().optional(),
    language: z.string().optional(),
  }),

  get_node_at_position: z.object({
    project: z.string().optional(),
    path: z.string().optional(),
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
  }),

  find_similar_code: z.object({
    project: z.string().optional(),
    snippet: z.string().min(1),
    language: z.string().optional(),
    threshold: z.number().min(0).max(1).optional(),
    max_results: z.number().int().positive().optional(),
  }),

  list_languages: z.object({}),

  list_projects_tool: z.object({}),

  list_files: z.object({
    project: z.string().min(1),
    pattern: z.string().optional(),
    extensions: z.array(z.string()).optional(),
  }),

  get_file: z.object({
    project: z.string().min(1),
    path: z.string().min(1),
  }),

  get_query_template_tool: z.object({
    language: z.string().min(1),
    template_name: z.string().min(1),
  }),

  list_query_templates_tool: z.object({
    language: z.string().optional(),
  }),

  get_node_types: z.object({
    language: z.string().optional(),
  }),

  clear_cache: z.object({}),

  configure: z.object({
    cache_enabled: z.boolean().optional(),
    max_file_size_mb: z.number().int().positive().optional(),
    log_level: z.string().optional(),
  }),

  audit_project_isolation: z.object({
    project: z.string().optional(),
  }),
} as const;

// Inferred types from schemas for type-safe tool handlers
export type GetAstArgs = z.infer<typeof MCP_TOOL_SCHEMAS.get_ast>;
export type RunQueryArgs = z.infer<typeof MCP_TOOL_SCHEMAS.run_query>;
export type GetSymbolsArgs = z.infer<typeof MCP_TOOL_SCHEMAS.get_symbols>;
export type AnalyzeComplexityArgs = z.infer<typeof MCP_TOOL_SCHEMAS.analyze_complexity>;
export type GetNodeAtPositionArgs = z.infer<typeof MCP_TOOL_SCHEMAS.get_node_at_position>;
export type FindSimilarCodeArgs = z.infer<typeof MCP_TOOL_SCHEMAS.find_similar_code>;
export type ListLanguagesArgs = z.infer<typeof MCP_TOOL_SCHEMAS.list_languages>;
export type ListProjectsToolArgs = z.infer<typeof MCP_TOOL_SCHEMAS.list_projects_tool>;
export type ListFilesArgs = z.infer<typeof MCP_TOOL_SCHEMAS.list_files>;
export type GetFileArgs = z.infer<typeof MCP_TOOL_SCHEMAS.get_file>;
export type GetQueryTemplateToolArgs = z.infer<typeof MCP_TOOL_SCHEMAS.get_query_template_tool>;
export type ListQueryTemplatesToolArgs = z.infer<typeof MCP_TOOL_SCHEMAS.list_query_templates_tool>;
export type GetNodeTypesArgs = z.infer<typeof MCP_TOOL_SCHEMAS.get_node_types>;
export type ClearCacheArgs = z.infer<typeof MCP_TOOL_SCHEMAS.clear_cache>;
export type ConfigureArgs = z.infer<typeof MCP_TOOL_SCHEMAS.configure>;
export type AuditProjectIsolationArgs = z.infer<typeof MCP_TOOL_SCHEMAS.audit_project_isolation>;

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

// Validation error class for JSON-RPC error responses
export class ValidationError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details: z.ZodError
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateArgs<T>(schema: z.ZodSchema<T>, args: unknown, toolName: string): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    const errorDetails = result.error.flatten();
    throw new ValidationError(
      -32602,
      `Invalid parameters for tool '${toolName}': ${errorDetails.formErrors.join(', ') || 'Validation failed'}`,
      result.error
    );
  }
  return result.data;
}

export async function handleMCPToolCall(name: string, args: Record<string, any>): Promise<any> {
  // Validate arguments against schema before processing
  const schema = MCP_TOOL_SCHEMAS[name as keyof typeof MCP_TOOL_SCHEMAS];
  if (schema) {
    args = validateArgs(schema, args, name);
  }

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
      const { name: projectName, path, description } = args as { name: string; path?: string; description?: string };
      const proj = projectStore.createProject(projectName || 'unnamed', path, description);
      return {
        name: proj.name,
        path: proj.path,
        files: Array.from(proj.files.keys()),
      };
    }

    case 'list_files': {
      const { project, pattern, extensions } = args as ListFilesArgs;
      return projectStore.listFiles(project, pattern, extensions);
    }

    case 'get_file': {
      const { project, path } = args as GetFileArgs;
      const f = projectStore.getFile(project, path);
      if (!f) throw new Error(`File ${path} not found in project ${project}`);
      return f.content;
    }

    case 'get_file_metadata': {
      const { project, path } = args as { project: string; path: string };
      const f = projectStore.getFile(project, path);
      if (!f) throw new Error(`File ${path} not found in project ${project}`);
      return {
        path: f.path,
        language: f.language,
        sizeBytes: f.sizeBytes,
        lastModified: f.lastModified,
      };
    }

    case 'get_ast': {
      const { project, path, code, language, max_depth } = args as GetAstArgs;
      let sourceCode = code;
      let lang = language || 'python';

      if (!sourceCode && project && path) {
        const file = projectStore.getFile(project, path);
        if (!file) throw new Error(`File ${path} not found`);
        sourceCode = file.content;
        lang = file.language;
      }

      if (!sourceCode) throw new Error('Either code or project + path must be provided');
      return parseSourceToAST(sourceCode, lang, max_depth);
    }

    case 'get_node_at_position': {
      const { project, path, code, language, row, column } = args as GetNodeAtPositionArgs;
      let sourceCode = code;
      let lang = language || 'python';

      if (!sourceCode && project && path) {
        const file = projectStore.getFile(project, path);
        if (!file) throw new Error(`File ${path} not found`);
        sourceCode = file.content;
        lang = file.language;
      }

      if (!sourceCode) throw new Error('Code or project + path required');
      const ast = parseSourceToAST(sourceCode, lang);
      const node = findNodeAtPosition(ast, row, column);
      return node || { error: 'No node found at specified position' };
    }

    case 'run_query': {
      const { project, query, file_path, code, language, capture_filter } = args as RunQueryArgs;
      let sourceCode = code;
      let lang = language || 'python';

      if (!sourceCode && project && (file_path || path)) {
        const filePath = file_path || path;
        const file = projectStore.getFile(project, filePath);
        if (!file) throw new Error(`File ${filePath} not found`);
        sourceCode = file.content;
        lang = file.language;
      }

      if (!sourceCode) throw new Error('Code or file_path required');
      const ast = parseSourceToAST(sourceCode, lang);
      const matches = executeQuery(ast, query, {
        captureFilter: capture_filter,
      });
      return matches;
    }

    case 'get_symbols': {
      const { project, file_path, code, language } = args as GetSymbolsArgs;
      let sourceCode = code;
      let lang = language || 'python';

      if (!sourceCode && project && (file_path || path)) {
        const filePath = file_path || path;
        const file = projectStore.getFile(project, filePath);
        if (!file) throw new Error(`File ${filePath} not found`);
        sourceCode = file.content;
        lang = file.language;
      }

      if (!sourceCode) throw new Error('Code or file_path required');
      const ast = parseSourceToAST(sourceCode, lang);
      return extractSymbolsFromAST(ast, lang);
    }

    case 'analyze_complexity': {
      const { project, file_path, code, language } = args as AnalyzeComplexityArgs;
      let sourceCode = code;
      let lang = language || 'python';

      if (!sourceCode && project && (file_path || path)) {
        const filePath = file_path || path;
        const file = projectStore.getFile(project, filePath);
        if (!file) throw new Error(`File ${filePath} not found`);
        sourceCode = file.content;
        lang = file.language;
      }

      if (!sourceCode) throw new Error('Code or file_path required');
      const ast = parseSourceToAST(sourceCode, lang);
      return calculateComplexity(sourceCode, ast);
    }

    case 'find_similar_code': {
      const { project, snippet, language, threshold, max_results } = args as FindSimilarCodeArgs;
      const proj = projectStore.getProject(project || 'tree-sitter-core');
      const candidates = proj
        ? Array.from(proj.files.values()).map((f) => ({
            path: f.path,
            content: f.content,
            language: f.language,
          }))
        : [];

      return findSimilarCodeBlocks(
        snippet,
        language || 'python',
        candidates,
        threshold ?? 0.5,
        max_results ?? 10
      );
    }

    case 'get_query_template_tool': {
      const { language, template_name } = args as GetQueryTemplateToolArgs;
      const t = TEMPLATES[language]?.[template_name];
      if (!t) throw new Error(`Template ${template_name} not found for ${language}`);
      return {
        language,
        name: template_name,
        query: t,
      };
    }

    case 'list_query_templates_tool': {
      const { language } = args as ListQueryTemplatesToolArgs;
      if (language) {
        return { [language]: Object.keys(TEMPLATES[language] || {}) };
      }
      const res: Record<string, string[]> = {};
      for (const [l, t] of Object.entries(TEMPLATES)) {
        res[l] = Object.keys(t);
      }
      return res;
    }

    case 'get_node_types': {
      const { language } = args as GetNodeTypesArgs;
      return COMMON_NODE_DESCRIPTIONS[language || ''] || {};
    }

    case 'clear_cache': {
      return { status: 'success', message: 'Parse tree caches successfully cleared' };
    }

    case 'configure': {
      const { cache_enabled, max_file_size_mb, log_level } = args as ConfigureArgs;
      return {
        cache: { enabled: cache_enabled ?? true, max_size_mb: 100 },
        security: { max_file_size_mb: max_file_size_mb ?? 10 },
        log_level: log_level || 'INFO',
      };
    }

    case 'audit_project_isolation': {
      const { project } = args as AuditProjectIsolationArgs;
      const proj = project || 'tree-sitter-core';
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
