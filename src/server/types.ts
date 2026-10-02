export interface ASTPosition {
  row: number; // 0-indexed
  column: number; // 0-indexed
}

export interface ASTNode {
  id: string;
  type: string;
  isNamed: boolean;
  field?: string;
  startPoint: ASTPosition;
  endPoint: ASTPosition;
  startByte: number;
  endByte: number;
  text?: string;
  children: ASTNode[];
}

export interface SymbolItem {
  name: string;
  type: 'function' | 'class' | 'method' | 'import' | 'interface' | 'variable' | 'type';
  signature?: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  parent?: string;
  docstring?: string;
}

export interface CodeComplexity {
  lineCount: number;
  codeLines: number;
  commentLines: number;
  commentRatio: number;
  functionCount: number;
  classCount: number;
  avgFunctionLines: number;
  cyclomaticComplexity: number;
}

export interface QueryCapture {
  capture: string;
  text: string;
  nodeType: string;
  startPoint: ASTPosition;
  endPoint: ASTPosition;
}

export interface QueryMatch {
  patternIndex: number;
  captures: QueryCapture[];
  matchedText?: string;
}

export interface ProjectFile {
  path: string;
  language: string;
  content: string;
  sizeBytes: number;
  lastModified: string;
}

export interface Project {
  name: string;
  path: string;
  description?: string;
  files: Map<string, ProjectFile>;
}

export interface SimilarityResult {
  filePath: string;
  score: number;
  matchedSnippet: string;
  lineStart: number;
  lineEnd: number;
}
