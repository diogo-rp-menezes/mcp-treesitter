/**
 * AST/Tree-sitter Language-Agnostic Specification - Section 3
 * Language Registry Interface & Extension Mapping
 */

import path from 'path';
import Parser from 'web-tree-sitter';
import {
  getTreeSitterLanguage,
  initTreeSitter,
  LANGUAGE_TO_WASM_MAP,
  isTreeSitterLanguageSupported,
} from './treeSitter';

export interface InstallableLanguage {
  identifier: string;
  displayName: string;
}

export class LanguageRegistry {
  private parserCache = new Map<string, Parser>();

  /**
   * Default extension to language mapping per Section 3.2 of the specification.
   */
  public static readonly EXTENSION_MAP: Record<string, string> = {
    '.py': 'python',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hh': 'cpp',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.scala': 'scala',
    '.dart': 'dart',
    '.lua': 'lua',
    '.hs': 'haskell',
    '.ml': 'ocaml',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.sql': 'sql',
    '.proto': 'proto',
    '.elm': 'elm',
    '.clj': 'clojure',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.jl': 'julia',
    '.apl': 'apl',
    '.toml': 'toml',
    '.vue': 'vue',
    '.zig': 'zig',
  };

  /**
   * Display names for installable/available languages.
   */
  public static readonly DISPLAY_NAMES: Record<string, string> = {
    python: 'Python',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    rust: 'Rust',
    go: 'Go',
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    java: 'Java',
    ruby: 'Ruby',
    php: 'PHP',
    swift: 'Swift',
    kotlin: 'Kotlin',
    scala: 'Scala',
    dart: 'Dart',
    lua: 'Lua',
    haskell: 'Haskell',
    ocaml: 'OCaml',
    bash: 'Bash / Shell',
    yaml: 'YAML',
    json: 'JSON',
    markdown: 'Markdown',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sql: 'SQL',
    proto: 'Protocol Buffers',
    elm: 'Elm',
    clojure: 'Clojure',
    elixir: 'Elixir',
    julia: 'Julia',
    apl: 'APL',
    toml: 'TOML',
  };

  /**
   * Maps a file path or extension to its tree-sitter language identifier.
   */
  public languageForFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    if (ext && LanguageRegistry.EXTENSION_MAP[ext]) {
      return LanguageRegistry.EXTENSION_MAP[ext];
    }
    const basename = path.basename(filePath).toLowerCase();
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'makefile') return 'make';
    return null;
  }

  /**
   * Retrieves tree-sitter Language instance.
   */
  public async getLanguage(languageName: string): Promise<Parser.Language | null> {
    const canonical = this.canonicalLanguageName(languageName);
    return await getTreeSitterLanguage(canonical);
  }

  /**
   * Returns a reusable Parser instance for the language.
   */
  public async getParser(languageName: string): Promise<Parser | null> {
    const canonical = this.canonicalLanguageName(languageName);
    const lang = await this.getLanguage(canonical);
    if (!lang) return null;

    if (!this.parserCache.has(canonical)) {
      const parser = new Parser();
      parser.setLanguage(lang);
      this.parserCache.set(canonical, parser);
    }

    return this.parserCache.get(canonical)!;
  }

  /**
   * Preloads the given language grammars.
   */
  public async preloadLanguages(languageNames: string[]): Promise<void> {
    await initTreeSitter();
    await Promise.all(languageNames.map((name) => this.getLanguage(name)));
  }

  /**
   * Lists all available language identifiers in the system.
   */
  public listAvailableLanguages(): string[] {
    const available = new Set<string>();
    for (const lang of Object.values(LanguageRegistry.EXTENSION_MAP)) {
      if (this.isLanguageAvailable(lang)) {
        available.add(lang);
      }
    }
    return Array.from(available).sort();
  }

  /**
   * Lists all installable/supported languages with human-readable display names.
   */
  public listInstallableLanguages(): InstallableLanguage[] {
    const seen = new Set<string>();
    const list: InstallableLanguage[] = [];

    for (const [id, displayName] of Object.entries(LanguageRegistry.DISPLAY_NAMES)) {
      if (!seen.has(id)) {
        seen.add(id);
        list.push({ identifier: id, displayName });
      }
    }
    return list;
  }

  /**
   * Checks if a language grammar is available in the WebAssembly pack.
   */
  public isLanguageAvailable(languageName: string): boolean {
    const canonical = this.canonicalLanguageName(languageName);
    return isTreeSitterLanguageSupported(canonical);
  }

  /**
   * Normalizes aliases (e.g. py -> python, c_sharp -> csharp, js -> javascript).
   */
  public canonicalLanguageName(language: string): string {
    const normalized = language.toLowerCase().trim();
    if (normalized === 'py') return 'python';
    if (normalized === 'js') return 'javascript';
    if (normalized === 'ts') return 'typescript';
    if (normalized === 'rs') return 'rust';
    if (normalized === 'c_sharp') return 'csharp';
    if (normalized === 'rb') return 'ruby';
    if (normalized === 'sh') return 'bash';
    return normalized;
  }
}

export const languageRegistry = new LanguageRegistry();
