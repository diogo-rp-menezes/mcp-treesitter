/**
 * AST/Tree-sitter Language-Agnostic Specification - Section 5
 * Core Operations API Implementation
 */

import path from 'path';
import Parser from 'web-tree-sitter';
import {
  Project,
  Symbol,
  SymbolType,
  ProjectAnalysis,
  EntryPoint,
  BuildFile,
  Dependencies,
  ComplexityMetrics,
  TextSearchResult,
  ContextLine,
  QueryMatch,
  SimilarCodeMatch,
  ASTNode,
  FileInfo,
} from './types';
import { LanguageRegistry, languageRegistry as defaultLanguageRegistry } from './languageRegistry';
import { TreeCache, treeCache as defaultTreeCache } from './treeCache';
import { validateFileAccess } from './security';
import { parseWithTreeSitter, syntaxNodeToASTNode } from './treeSitter';
import { DEFAULT_SYMBOL_TYPES, TEMPLATES } from './templates';
import { executeQuery } from './queryEngine';
import { calculateComplexity } from './complexity';
import { FileAccessError, QueryError } from './errors';

/**
 * 5.1 Symbol Extraction
 */
export async function extractSymbols(
  project: Project,
  filePath: string,
  langRegistry: LanguageRegistry = defaultLanguageRegistry,
  symbolTypes?: SymbolType[],
  excludeClassMethods: boolean = false
): Promise<Record<SymbolType, Symbol[]>> {
  validateFileAccess(filePath, project.path);

  const file = project.files.get(filePath);
  if (!file) {
    throw new FileAccessError(`File '${filePath}' not found in project '${project.name}'`);
  }

  const lang = file.language || langRegistry.languageForFile(filePath) || 'python';
  const typesToExtract =
    symbolTypes && symbolTypes.length > 0
      ? symbolTypes
      : DEFAULT_SYMBOL_TYPES[lang] || DEFAULT_SYMBOL_TYPES.default;

  const results: Record<string, Symbol[]> = {};
  for (const t of typesToExtract) {
    results[t] = [];
  }

  const ast = await parseWithTreeSitter(file.content, lang);
  if (!ast) {
    return results as Record<SymbolType, Symbol[]>;
  }

  // Collect class location boundaries if excludeClassMethods is true
  const classRanges: { start: number; end: number }[] = [];

  function scanNodes(node: ASTNode, parentClass?: string) {
    const isClassNode =
      node.type === 'class_definition' ||
      node.type === 'class_declaration' ||
      node.type === 'class_specifier';

    const isFuncNode =
      node.type === 'function_definition' ||
      node.type === 'function_declaration' ||
      node.type === 'method_definition' ||
      node.type === 'method_declaration' ||
      node.type === 'function_item' ||
      node.type === 'arrow_function';

    const isStructNode =
      node.type === 'struct_item' ||
      node.type === 'struct_specifier' ||
      (node.type === 'type_spec' && node.text?.includes('struct'));

    const isInterfaceNode =
      node.type === 'interface_declaration' ||
      (node.type === 'type_spec' && node.text?.includes('interface'));

    const isImportNode =
      node.type === 'import_statement' ||
      node.type === 'import_from_statement' ||
      node.type === 'use_declaration' ||
      node.type === 'import_declaration' ||
      node.type === 'preproc_include';

    if (isClassNode) {
      classRanges.push({ start: node.startPoint.row, end: node.endPoint.row });
      const nameNode = node.children.find(
        (c) => c.field === 'name' || c.type === 'identifier' || c.type === 'type_identifier'
      );
      const name = nameNode?.text || 'AnonymousClass';

      if (results.classes) {
        results.classes.push({
          name,
          type: 'classes',
          location: { start: node.startPoint, end: node.endPoint },
          startLine: node.startPoint.row,
          endLine: node.endPoint.row,
          startColumn: node.startPoint.column,
          endColumn: node.endPoint.column,
        });
      }

      for (const child of node.children) {
        scanNodes(child, name);
      }
      return;
    }

    if (isFuncNode) {
      const isInsideClass =
        Boolean(parentClass) ||
        classRanges.some((r) => node.startPoint.row >= r.start && node.endPoint.row <= r.end);

      if (!excludeClassMethods || !isInsideClass) {
        const nameNode = node.children.find(
          (c) =>
            c.field === 'name' ||
            c.type === 'identifier' ||
            c.type === 'property_identifier' ||
            c.type === 'field_identifier'
        );
        const name = nameNode?.text || 'anonymous';
        const paramsNode = node.children.find(
          (c) =>
            c.field === 'parameters' ||
            c.type === 'parameters' ||
            c.type === 'formal_parameters' ||
            c.type === 'parameter_list'
        );

        if (results.functions) {
          results.functions.push({
            name,
            type: 'functions',
            location: { start: node.startPoint, end: node.endPoint },
            startLine: node.startPoint.row,
            endLine: node.endPoint.row,
            startColumn: node.startPoint.column,
            endColumn: node.endPoint.column,
            metadata: {
              signature: paramsNode?.text ? `${name}${paramsNode.text}` : undefined,
              parent: parentClass,
              is_static: node.text?.includes('static'),
              is_async: node.text?.includes('async'),
            },
            signature: paramsNode?.text ? `${name}${paramsNode.text}` : undefined,
            parent: parentClass,
          });
        }
      }
    }

    if (isStructNode && results.structs) {
      const nameNode = node.children.find(
        (c) => c.field === 'name' || c.type === 'type_identifier' || c.type === 'identifier'
      );
      results.structs.push({
        name: nameNode?.text || 'AnonymousStruct',
        type: 'structs',
        location: { start: node.startPoint, end: node.endPoint },
        startLine: node.startPoint.row,
        endLine: node.endPoint.row,
        startColumn: node.startPoint.column,
        endColumn: node.endPoint.column,
      });
    }

    if (isInterfaceNode && results.interfaces) {
      const nameNode = node.children.find(
        (c) => c.field === 'name' || c.type === 'type_identifier' || c.type === 'identifier'
      );
      results.interfaces.push({
        name: nameNode?.text || 'AnonymousInterface',
        type: 'interfaces',
        location: { start: node.startPoint, end: node.endPoint },
        startLine: node.startPoint.row,
        endLine: node.endPoint.row,
        startColumn: node.startPoint.column,
        endColumn: node.endPoint.column,
      });
    }

    if (isImportNode && results.imports) {
      results.imports.push({
        name: node.text || '',
        type: 'imports',
        location: { start: node.startPoint, end: node.endPoint },
        startLine: node.startPoint.row,
        endLine: node.endPoint.row,
        startColumn: node.startPoint.column,
        endColumn: node.endPoint.column,
      });
    }

    for (const child of node.children) {
      scanNodes(child, parentClass);
    }
  }

  scanNodes(ast);
  return results as Record<SymbolType, Symbol[]>;
}

/**
 * 5.2 Project Structure Analysis
 */
export function analyzeProjectStructure(
  project: Project,
  langRegistry: LanguageRegistry = defaultLanguageRegistry,
  scanDepth: number = 3
): ProjectAnalysis {
  const languages: Record<string, number> = {};
  const entryPoints: EntryPoint[] = [];
  const buildFiles: BuildFile[] = [];
  const dirCounts: Record<string, number> = {};
  const fileCounts: Record<string, number> = {};

  const ENTRY_POINT_PATTERNS: Record<string, string[]> = {
    python: ['__main__.py', 'main.py', 'app.py', 'run.py', 'manage.py'],
    javascript: ['index.js', 'app.js', 'main.js', 'server.js'],
    typescript: ['index.ts', 'app.ts', 'main.ts', 'server.ts'],
    go: ['main.go'],
    rust: ['main.rs'],
    java: ['Main.java', 'App.java'],
  };

  const BUILD_FILE_PATTERNS: Record<string, string[]> = {
    python: ['setup.py', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'environment.yml'],
    javascript: ['package.json', 'yarn.lock', 'npm-shrinkwrap.json'],
    typescript: ['tsconfig.json'],
    go: ['go.mod', 'go.sum'],
    rust: ['Cargo.toml', 'Cargo.lock'],
    java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    generic: ['Makefile', 'CMakeLists.txt', 'Dockerfile', 'docker-compose.yml'],
  };

  for (const [filePath, file] of project.files.entries()) {
    const lang = file.language || langRegistry.languageForFile(filePath) || 'unknown';
    languages[lang] = (languages[lang] || 0) + 1;

    const ext = path.extname(filePath) || 'no_extension';
    fileCounts[ext] = (fileCounts[ext] || 0) + 1;

    const dir = path.dirname(filePath);
    dirCounts[dir] = (dirCounts[dir] || 0) + 1;

    const baseName = path.basename(filePath);

    // Entry points check
    for (const [epLang, patterns] of Object.entries(ENTRY_POINT_PATTERNS)) {
      if (patterns.includes(baseName)) {
        entryPoints.push({ path: filePath, language: epLang });
      }
    }

    // Build files check
    for (const [category, patterns] of Object.entries(BUILD_FILE_PATTERNS)) {
      if (patterns.includes(baseName)) {
        buildFiles.push({ path: filePath, type: category });
      }
    }
  }

  return {
    name: project.name,
    path: project.path,
    languages,
    entry_points: entryPoints,
    build_files: buildFiles,
    dir_counts: dirCounts,
    file_counts: fileCounts,
    total_files: project.files.size,
  };
}

/**
 * 5.3 Dependency Analysis
 */
export async function findDependencies(
  project: Project,
  filePath: string,
  langRegistry: LanguageRegistry = defaultLanguageRegistry
): Promise<Dependencies> {
  validateFileAccess(filePath, project.path);
  const file = project.files.get(filePath);
  if (!file) {
    throw new FileAccessError(`File '${filePath}' not found in project '${project.name}'`);
  }

  const lang = file.language || langRegistry.languageForFile(filePath) || 'python';
  const deps: Dependencies = {
    imports: [],
    from_imports: [],
    items: [],
    aliases: [],
    includes: [],
    requires: [],
    uses: [],
  };

  const ast = await parseWithTreeSitter(file.content, lang);
  if (!ast) return deps;

  function traverse(node: ASTNode) {
    if (node.type === 'import_statement') {
      const text = node.text?.trim() || '';
      deps.imports.push(text);
    } else if (node.type === 'import_from_statement') {
      const moduleName = node.children.find((c) => c.field === 'module_name')?.text || '';
      if (moduleName) deps.from_imports.push(moduleName);
      deps.imports.push(node.text?.trim() || '');
    } else if (node.type === 'use_declaration') {
      deps.uses.push(node.text?.trim() || '');
    } else if (node.type === 'preproc_include') {
      deps.includes.push(node.text?.trim() || '');
    } else if (node.type === 'call_expression') {
      if (node.text?.includes('require(')) {
        deps.requires.push(node.text.trim());
      }
    }

    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(ast);

  // Deduplicate
  for (const key of Object.keys(deps)) {
    deps[key] = Array.from(new Set(deps[key]));
  }

  return deps;
}

/**
 * 5.4 Complexity Analysis (McCabes Cyclomatic Complexity with Appendix C Decision Nodes)
 */
export async function analyzeCodeComplexity(
  project: Project,
  filePath: string,
  langRegistry: LanguageRegistry = defaultLanguageRegistry
): Promise<ComplexityMetrics> {
  validateFileAccess(filePath, project.path);
  const file = project.files.get(filePath);
  if (!file) {
    throw new FileAccessError(`File '${filePath}' not found in project '${project.name}'`);
  }

  const lang = file.language || langRegistry.languageForFile(filePath) || 'python';
  const ast = await parseWithTreeSitter(file.content, lang);

  const metrics = calculateComplexity(file.content, ast, lang);

  return {
    line_count: metrics.lineCount,
    code_lines: metrics.codeLines,
    empty_lines: Math.max(0, metrics.lineCount - metrics.codeLines - metrics.commentLines),
    comment_lines: metrics.commentLines,
    comment_ratio: metrics.commentRatio,
    function_count: metrics.functionCount,
    class_count: metrics.classCount,
    avg_function_lines: metrics.avgFunctionLines,
    cyclomatic_complexity: metrics.cyclomaticComplexity,
    language: lang,
    // Dual compatibility
    lineCount: metrics.lineCount,
    codeLines: metrics.codeLines,
    commentLines: metrics.commentLines,
    commentRatio: metrics.commentRatio,
    functionCount: metrics.functionCount,
    classCount: metrics.classCount,
    avgFunctionLines: metrics.avgFunctionLines,
    cyclomaticComplexity: metrics.cyclomaticComplexity,
  };
}

/**
 * 5.5 Text Search
 */
export function searchText(
  project: Project,
  pattern: string,
  filePattern: string = '**/*',
  maxResults: number = 100,
  caseSensitive: boolean = false,
  wholeWord: boolean = false,
  useRegex: boolean = false,
  contextLines: number = 0
): TextSearchResult[] {
  const results: TextSearchResult[] = [];

  let regex: RegExp;
  try {
    let expr = pattern;
    if (!useRegex) {
      expr = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (wholeWord) {
      expr = `\\b${expr}\\b`;
    }
    regex = new RegExp(expr, caseSensitive ? 'g' : 'gi');
  } catch (err: any) {
    throw new QueryError(`Invalid search regular expression: ${err.message}`);
  }

  for (const [filePath, file] of project.files.entries()) {
    if (results.length >= maxResults) break;

    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) break;

      const lineText = lines[i];
      regex.lastIndex = 0;
      if (regex.test(lineText)) {
        let context: ContextLine[] | undefined;
        if (contextLines > 0) {
          context = [];
          const startIdx = Math.max(0, i - contextLines);
          const endIdx = Math.min(lines.length - 1, i + contextLines);
          for (let c = startIdx; c <= endIdx; c++) {
            context.push({
              line: c + 1,
              text: lines[c],
              is_match: c === i,
            });
          }
        }

        results.push({
          file: filePath,
          line: i + 1,
          text: lineText,
          context,
        });
      }
    }
  }

  return results;
}

/**
 * 5.6 Tree-sitter Query Execution
 */
export async function queryCode(
  project: Project,
  queryString: string,
  langRegistry: LanguageRegistry = defaultLanguageRegistry,
  cache: TreeCache = defaultTreeCache,
  filePath?: string,
  language?: string,
  maxResults: number = 100,
  includeSnippets: boolean = true,
  captureFilter?: string,
  compact: boolean = false
): Promise<QueryMatch[]> {
  const matches: QueryMatch[] = [];

  const filesToQuery: { path: string; content: string; language: string }[] = [];

  if (filePath) {
    validateFileAccess(filePath, project.path);
    const file = project.files.get(filePath);
    if (!file) throw new FileAccessError(`File '${filePath}' not found`);
    filesToQuery.push({
      path: filePath,
      content: file.content,
      language: file.language || langRegistry.languageForFile(filePath) || 'python',
    });
  } else {
    const targetLang = (language || 'python').toLowerCase();
    for (const [p, f] of project.files.entries()) {
      const fLang = (f.language || langRegistry.languageForFile(p) || '').toLowerCase();
      if (fLang === targetLang) {
        filesToQuery.push({ path: p, content: f.content, language: fLang });
      }
    }
  }

  for (const f of filesToQuery) {
    if (matches.length >= maxResults) break;

    const ast = await parseWithTreeSitter(f.content, f.language);
    if (!ast) continue;

    const queryResults = executeQuery(ast, queryString, {
      captureFilter,
      maxResults: maxResults - matches.length,
    });

    for (const qr of queryResults) {
      if (matches.length >= maxResults) break;
      for (const cap of qr.captures) {
        matches.push({
          capture: cap.capture,
          text: includeSnippets ? cap.text : '',
          location: { start: cap.startPoint, end: cap.endPoint },
          node_type: cap.nodeType,
          file: f.path,
          patternIndex: qr.patternIndex,
          captures: qr.captures,
          matchedText: qr.matchedText,
        });
      }
    }
  }

  return matches;
}

/**
 * 5.7 Similar Code Detection (Containment Similarity)
 */
export async function findSimilarCode(
  project: Project,
  snippet: string,
  langRegistry: LanguageRegistry = defaultLanguageRegistry,
  cache: TreeCache = defaultTreeCache,
  language: string,
  threshold: number = 0.5,
  maxResults: number = 10
): Promise<SimilarCodeMatch[]> {
  const snippetAST = await parseWithTreeSitter(snippet, language);
  if (!snippetAST) return [];

  // Build snippet structural fingerprint: set of (type:text) for leaves + type for interiors
  const snippetFp = new Set<string>();
  function fingerprint(node: ASTNode, set: Set<string>) {
    if (!node.children || node.children.length === 0) {
      set.add(`${node.type}:${node.text || ''}`);
    } else {
      set.add(node.type);
    }
    for (const c of node.children) {
      fingerprint(c, set);
    }
  }
  fingerprint(snippetAST, snippetFp);
  if (snippetFp.size === 0) return [];

  const candidates: SimilarCodeMatch[] = [];

  for (const [filePath, file] of project.files.entries()) {
    const fLang = file.language || langRegistry.languageForFile(filePath) || '';
    if (fLang.toLowerCase() !== language.toLowerCase()) continue;

    const fileAST = await parseWithTreeSitter(file.content, fLang);
    if (!fileAST) continue;

    // Traverse top-level blocks
    function scanBlocks(node: ASTNode) {
      const isBlock =
        node.type === 'function_definition' ||
        node.type === 'function_declaration' ||
        node.type === 'class_definition' ||
        node.type === 'class_declaration' ||
        node.type === 'method_definition' ||
        node.type === 'impl_item';

      if (isBlock) {
        const blockFp = new Set<string>();
        fingerprint(node, blockFp);

        // Containment similarity: |snippet_fp ∩ block_fp| / |snippet_fp|
        let intersection = 0;
        for (const token of snippetFp) {
          if (blockFp.has(token)) intersection++;
        }
        const sim = intersection / snippetFp.size;

        if (sim >= threshold) {
          candidates.push({
            file: filePath,
            location: { start: node.startPoint, end: node.endPoint },
            similarity: Math.round(sim * 100) / 100,
            node_type: node.type,
            text: (node.text || '').slice(0, 150),
          });
        }
      }

      for (const child of node.children) {
        scanBlocks(child);
      }
    }

    scanBlocks(fileAST);
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, maxResults);
}

/**
 * 5.8 AST Retrieval (with cursor-based depth limiting)
 */
export async function getFileAST(
  project: Project,
  filePath: string,
  langRegistry: LanguageRegistry = defaultLanguageRegistry,
  cache: TreeCache = defaultTreeCache,
  maxDepth: number = 5,
  includeText: boolean = true
): Promise<{ file: string; language: string; tree: ASTNode }> {
  validateFileAccess(filePath, project.path);
  const file = project.files.get(filePath);
  if (!file) {
    throw new FileAccessError(`File '${filePath}' not found in project '${project.name}'`);
  }

  const lang = file.language || langRegistry.languageForFile(filePath) || 'python';
  const ast = await parseWithTreeSitter(file.content, lang);
  if (!ast) {
    throw new FileAccessError(`Could not generate AST for '${filePath}'`);
  }

  // Prune according to maxDepth and includeText
  function prune(node: ASTNode, currentDepth: number): ASTNode {
    const copy: ASTNode = {
      id: node.id,
      type: node.type,
      isNamed: node.isNamed,
      field: node.field,
      startPoint: node.startPoint,
      endPoint: node.endPoint,
      start_point: node.startPoint,
      end_point: node.endPoint,
      startByte: node.startByte,
      endByte: node.endByte,
      start_byte: node.startByte,
      end_byte: node.endByte,
      text: includeText ? node.text : undefined,
      depth: currentDepth,
      children: [],
    };

    if (currentDepth < maxDepth && node.children) {
      copy.children = node.children.map((c) => prune(c, currentDepth + 1));
    }

    return copy;
  }

  return {
    file: filePath,
    language: lang,
    tree: prune(ast, 0),
  };
}

/**
 * 5.9 Find Node At Position
 */
export function findNodeAtPosition(
  rootNode: ASTNode,
  row: number,
  column: number
): ASTNode | null {
  function inside(node: ASTNode): boolean {
    if (row < node.startPoint.row || row > node.endPoint.row) return false;
    if (row === node.startPoint.row && column < node.startPoint.column) return false;
    if (row === node.endPoint.row && column > node.endPoint.column) return false;
    return true;
  }

  if (!inside(rootNode)) return null;

  for (const child of rootNode.children) {
    const matched = findNodeAtPosition(child, row, column);
    if (matched) return matched;
  }

  return rootNode;
}

/**
 * 5.10 File Operations
 */
export function listProjectFiles(
  project: Project,
  pattern?: string,
  maxDepth?: number,
  filterExtensions?: string[]
): string[] {
  const result: string[] = [];
  const normalizedExts = filterExtensions
    ? filterExtensions.map((e) => `.${e.toLowerCase().replace(/^\./, '')}`)
    : null;

  for (const p of project.files.keys()) {
    if (maxDepth !== undefined) {
      const parts = p.split(/[\\/]/);
      if (parts.length > maxDepth) continue;
    }
    if (normalizedExts) {
      const ext = path.extname(p).toLowerCase();
      if (!normalizedExts.includes(ext)) continue;
    }
    result.push(p);
  }

  return result.sort();
}

export function getFileContent(
  project: Project,
  filePath: string,
  asBytes: boolean = false,
  maxLines?: number,
  startLine: number = 0
): string | Uint8Array {
  validateFileAccess(filePath, project.path);
  const file = project.files.get(filePath);
  if (!file) {
    throw new FileAccessError(`File '${filePath}' not found`);
  }

  let text = file.content;
  if (startLine > 0 || maxLines !== undefined) {
    const lines = text.split(/\r?\n/);
    const sliced = lines.slice(startLine, maxLines ? startLine + maxLines : undefined);
    text = sliced.join('\n');
  }

  if (asBytes) {
    return new TextEncoder().encode(text);
  }
  return text;
}

export function getFileInfo(project: Project, filePath: string): FileInfo {
  validateFileAccess(filePath, project.path);
  const file = project.files.get(filePath);
  if (!file) {
    throw new FileAccessError(`File '${filePath}' not found`);
  }

  const lines = file.content.split(/\r?\n/).length;
  const ext = path.extname(filePath).replace(/^\./, '') || null;

  return {
    path: filePath,
    size: file.sizeBytes || new TextEncoder().encode(file.content).length,
    last_modified: new Date(file.lastModified).getTime(),
    created: new Date(file.lastModified).getTime(),
    is_directory: false,
    extension: ext,
    line_count: lines,
  };
}
