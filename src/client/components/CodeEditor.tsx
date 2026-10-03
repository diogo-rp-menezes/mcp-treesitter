import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Code2,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Zap,
  Box,
  Braces,
  Variable,
  Layers,
  Key,
  Columns,
} from 'lucide-react';
import { ASTNode, SymbolItem } from '../types';
import { CodeMiniMap } from './CodeMiniMap';

export interface AutocompleteItem {
  label: string;
  kind: 'function' | 'class' | 'variable' | 'keyword' | 'import';
  detail?: string;
}

interface CodeEditorProps {
  code: string;
  language: string;
  filename: string;
  selectedNode: ASTNode | null;
  symbols?: Record<string, SymbolItem[]>;
  onChangeCode: (code: string) => void;
  onCopyCode: () => void;
}

// Common programming language keywords for autocomplete suggestions
const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  python: [
    'def', 'class', 'return', 'import', 'from', 'if', 'elif', 'else', 'for', 'while',
    'try', 'except', 'finally', 'with', 'as', 'lambda', 'yield', 'async', 'await',
    'self', 'None', 'True', 'False', 'is', 'not', 'and', 'or', 'pass', 'break', 'continue',
    'raise', 'global', 'nonlocal', 'assert', 'in', 'del'
  ],
  typescript: [
    'function', 'class', 'interface', 'type', 'const', 'let', 'var', 'return',
    'import', 'export', 'from', 'async', 'await', 'if', 'else', 'for', 'while',
    'switch', 'case', 'break', 'default', 'try', 'catch', 'finally', 'throw',
    'new', 'this', 'super', 'extends', 'implements', 'public', 'private', 'protected',
    'static', 'readonly', 'null', 'undefined', 'true', 'false', 'typeof', 'instanceof'
  ],
  javascript: [
    'function', 'class', 'const', 'let', 'var', 'return', 'import', 'export',
    'from', 'async', 'await', 'if', 'else', 'for', 'while', 'switch', 'case',
    'try', 'catch', 'finally', 'new', 'this', 'null', 'undefined', 'true', 'false'
  ],
  go: [
    'func', 'type', 'struct', 'interface', 'package', 'import', 'return',
    'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'var', 'const',
    'defer', 'go', 'select', 'chan', 'make', 'new', 'nil', 'true', 'false',
    'break', 'continue', 'fallthrough', 'goto', 'map'
  ],
  rust: [
    'fn', 'struct', 'enum', 'impl', 'trait', 'let', 'mut', 'pub', 'use',
    'return', 'match', 'if', 'else', 'for', 'while', 'loop', 'self', 'Self',
    'mod', 'crate', 'as', 'where', 'move', 'async', 'await', 'unsafe',
    'Ok', 'Err', 'Some', 'None', 'true', 'false'
  ],
  java: [
    'class', 'interface', 'public', 'private', 'protected', 'static', 'final',
    'void', 'return', 'new', 'this', 'super', 'extends', 'implements', 'import',
    'package', 'if', 'else', 'for', 'while', 'try', 'catch', 'finally', 'throw'
  ],
  cpp: [
    'class', 'struct', 'template', 'typename', 'public', 'private', 'protected',
    'namespace', 'using', 'auto', 'void', 'return', 'new', 'delete', 'this',
    'if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'const'
  ],
};

export function CodeEditor({
  code,
  language,
  filename,
  selectedNode,
  symbols,
  onChangeCode,
  onCopyCode,
}: CodeEditorProps) {
  const [copied, setCopied] = useState(false);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(true);
  const [showMiniMap, setShowMiniMap] = useState(true);

  // Autocomplete UI state
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPopup, setShowPopup] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [prefixRange, setPrefixRange] = useState<{ start: number; end: number; prefix: string }>({
    start: 0,
    end: 0,
    prefix: '',
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);

  const lines = code.split('\n');

  const highlightStartRow = selectedNode ? selectedNode.startPoint.row : null;
  const highlightEndRow = selectedNode ? selectedNode.endPoint.row : null;

  // Build the dictionary of all available symbols & keywords
  const allAvailableItems = useMemo(() => {
    const itemsMap = new Map<string, AutocompleteItem>();

    // 1. Language Keywords
    const langKey = language?.toLowerCase() || 'python';
    const keywords = LANGUAGE_KEYWORDS[langKey] || LANGUAGE_KEYWORDS['python'] || [];
    for (const kw of keywords) {
      itemsMap.set(`kw:${kw}`, {
        label: kw,
        kind: 'keyword',
        detail: `palavra-chave (${language})`,
      });
    }

    // 2. Tree-sitter Extracted Symbols from App State
    if (symbols) {
      // Functions
      if (Array.isArray(symbols.functions)) {
        for (const fn of symbols.functions) {
          if (fn.name && !itemsMap.has(`fn:${fn.name}`)) {
            itemsMap.set(`fn:${fn.name}`, {
              label: fn.name,
              kind: 'function',
              detail: fn.signature || `func ${fn.name}()`,
            });
          }
        }
      }

      // Classes
      if (Array.isArray(symbols.classes)) {
        for (const cls of symbols.classes) {
          if (cls.name && !itemsMap.has(`cls:${cls.name}`)) {
            itemsMap.set(`cls:${cls.name}`, {
              label: cls.name,
              kind: 'class',
              detail: `class ${cls.name}`,
            });
          }
        }
      }

      // Variables
      if (Array.isArray(symbols.variables)) {
        for (const v of symbols.variables) {
          if (v.name && !itemsMap.has(`var:${v.name}`)) {
            itemsMap.set(`var:${v.name}`, {
              label: v.name,
              kind: 'variable',
              detail: v.type ? `var (${v.type})` : 'variável identificada',
            });
          }
        }
      }

      // Imports
      if (Array.isArray(symbols.imports)) {
        for (const imp of symbols.imports) {
          if (imp.name && !itemsMap.has(`imp:${imp.name}`)) {
            itemsMap.set(`imp:${imp.name}`, {
              label: imp.name,
              kind: 'import',
              detail: 'módulo importado',
            });
          }
        }
      }
    }

    return Array.from(itemsMap.values());
  }, [language, symbols]);

  // Recalculate autocomplete matches when cursor moves or user edits code
  const updateAutocomplete = useCallback(() => {
    if (!autocompleteEnabled) {
      setShowPopup(false);
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursor = textarea.selectionStart;
    const textBefore = code.slice(0, cursor);

    // Look for identifier prefix immediately preceding cursor: [a-zA-Z_0-9]
    const match = textBefore.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (!match) {
      setShowPopup(false);
      return;
    }

    const prefix = match[1];
    if (prefix.length < 1) {
      setShowPopup(false);
      return;
    }

    const lowerPrefix = prefix.toLowerCase();

    // Filter items: prioritize exact prefix match, then contains
    const matched = allAvailableItems
      .filter((item) => item.label.toLowerCase().includes(lowerPrefix))
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(lowerPrefix);
        const bStarts = b.label.toLowerCase().startsWith(lowerPrefix);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        // Prioritize symbols over keywords if prefixes are equal
        if (a.kind !== 'keyword' && b.kind === 'keyword') return -1;
        if (a.kind === 'keyword' && b.kind !== 'keyword') return 1;

        return a.label.localeCompare(b.label);
      })
      .slice(0, 8); // Top 8 suggestions

    if (matched.length === 0) {
      setShowPopup(false);
      return;
    }

    // Calculate approximate caret coordinates inside textarea
    const linesBefore = textBefore.split('\n');
    const row = linesBefore.length - 1;
    const col = linesBefore[linesBefore.length - 1].length;

    const lineHeight = 20; // 20px leading-5
    const charWidth = 7.2; // approx monospace width for 12px

    const top = (row + 1) * lineHeight + 12 - textarea.scrollTop;
    const left = col * charWidth + 12 - textarea.scrollLeft;

    setPrefixRange({
      start: cursor - prefix.length,
      end: cursor,
      prefix,
    });
    setSuggestions(matched);
    setSelectedIndex(0);
    setPopupPos({
      top: Math.max(28, top),
      left: Math.max(16, Math.min(left, 360)),
    });
    setShowPopup(true);
  }, [code, allAvailableItems, autocompleteEnabled]);

  // Insert the selected suggestion into textarea
  const applySuggestion = useCallback(
    (item: AutocompleteItem) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const before = code.slice(0, prefixRange.start);
      const after = code.slice(prefixRange.end);

      let insertText = item.label;
      // If it's a function and not already followed by parenthesis, user can append ()
      const newCode = `${before}${insertText}${after}`;
      onChangeCode(newCode);

      const newCursorPos = prefixRange.start + insertText.length;
      setShowPopup(false);

      // Restore focus and cursor position in next tick
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 10);
    },
    [code, prefixRange, onChangeCode]
  );

  // Keyboard navigation for autocomplete popup
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPopup && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }

      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setShowPopup(false);
        return;
      }
    }

    // Trigger autocomplete manually with Ctrl+Space
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      updateAutocomplete();
    }
  };

  const handleCopy = () => {
    onCopyCode();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper icon for suggestion item kind
  const renderItemKindBadge = (kind: AutocompleteItem['kind']) => {
    switch (kind) {
      case 'function':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" />
            func
          </span>
        );
      case 'class':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-950/80 text-purple-300 border border-purple-800/60 flex items-center gap-1">
            <Braces className="w-2.5 h-2.5" />
            class
          </span>
        );
      case 'variable':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 flex items-center gap-1">
            <Variable className="w-2.5 h-2.5" />
            var
          </span>
        );
      case 'keyword':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800/60 flex items-center gap-1">
            <Key className="w-2.5 h-2.5" />
            kw
          </span>
        );
      case 'import':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
            <Box className="w-2.5 h-2.5" />
            mod
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0f18] overflow-hidden select-text">
      {/* Top Bar for Editor */}
      <div className="h-9 px-3 border-b border-slate-800 bg-[#0e1422] flex items-center justify-between text-xs shrink-0 select-none">
        <div className="flex items-center gap-2 text-slate-300">
          <Code2 className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-mono font-medium">{filename}</span>
          <span className="text-[11px] text-slate-500">
            ({lines.length} linhas · {code.length} caracteres)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {selectedNode && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 font-mono">
              Nó Ativo: L{selectedNode.startPoint.row + 1} - L{selectedNode.endPoint.row + 1}
            </span>
          )}

          <button
            onClick={() => setShowMiniMap((prev) => !prev)}
            className={`px-2 py-1 border rounded text-[11px] flex items-center gap-1 transition ${
              showMiniMap
                ? 'bg-cyan-950/80 border-cyan-700/80 text-cyan-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Alternar mini-mapa do código"
          >
            <Columns className="w-3 h-3" />
            <span>Mini-mapa</span>
          </button>

          <button
            onClick={handleCopy}
            className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 text-[11px] flex items-center gap-1 transition"
            title="Copiar código para a área de transferência"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>

      {/* Editor Body with Line Numbers & Autocomplete Overlay */}
      <div
        ref={editorBodyRef}
        className="flex-1 flex overflow-hidden relative font-mono text-xs"
      >
        {/* Line Numbers Gutter */}
        <div className="w-12 py-3 bg-[#090d15] text-slate-600 select-none text-right pr-3 font-mono text-xs border-r border-slate-850 shrink-0 overflow-hidden">
          {lines.map((_, i) => {
            const isHighlighted =
              highlightStartRow !== null &&
              highlightEndRow !== null &&
              i >= highlightStartRow &&
              i <= highlightEndRow;

            return (
              <div
                key={i}
                className={`leading-5 ${
                  isHighlighted ? 'text-cyan-400 font-bold bg-cyan-500/10' : ''
                }`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* Text Area */}
        <div className="flex-1 relative overflow-hidden p-3">
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => {
              onChangeCode(e.target.value);
            }}
            onKeyUp={(e) => {
              // Ignore arrow keys that are handled by onKeyDown
              if (
                e.key !== 'ArrowDown' &&
                e.key !== 'ArrowUp' &&
                e.key !== 'Enter' &&
                e.key !== 'Tab' &&
                e.key !== 'Escape'
              ) {
                updateAutocomplete();
              }
            }}
            onClick={updateAutocomplete}
            onKeyDown={handleKeyDown}
            placeholder="Digite ou cole seu código-fonte aqui..."
            className="w-full h-full bg-transparent text-slate-200 resize-none focus:outline-none font-mono text-xs leading-5 whitespace-pre selection:bg-cyan-500/30 overflow-auto"
            spellCheck={false}
          />

          {/* Autocomplete Popup */}
          {showPopup && suggestions.length > 0 && (
            <div
              style={{
                top: `${popupPos.top}px`,
                left: `${popupPos.left}px`,
              }}
              className="absolute z-50 w-72 max-h-60 bg-[#0c1220] border border-cyan-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col font-mono text-xs backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
            >
              {/* Header */}
              <div className="px-2.5 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-[10px] text-slate-400 select-none">
                <span className="flex items-center gap-1 font-semibold text-cyan-300">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  Sugestões Tree-sitter
                </span>
                <span className="text-slate-500 font-sans">Tab ou Enter ↵</span>
              </div>

              {/* Suggestions List */}
              <div className="overflow-y-auto max-h-48 divide-y divide-slate-850/60 p-1">
                {suggestions.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <div
                      key={`${item.kind}-${item.label}`}
                      onClick={() => applySuggestion(item)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition ${
                        isSelected
                          ? 'bg-cyan-950/70 border-l-2 border-cyan-400 text-cyan-200 font-semibold'
                          : 'text-slate-300 hover:bg-slate-900/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <span className="truncate">
                          {/* Highlight matching prefix */}
                          <span className="text-cyan-400 font-bold">
                            {item.label.slice(0, prefixRange.prefix.length)}
                          </span>
                          <span>{item.label.slice(prefixRange.prefix.length)}</span>
                        </span>

                        {item.detail && (
                          <span className="text-[10px] text-slate-500 truncate hidden sm:inline">
                            {item.detail}
                          </span>
                        )}
                      </div>

                      <div className="shrink-0 ml-2">
                        {renderItemKindBadge(item.kind)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer status / shortcuts */}
              <div className="px-2 py-1 bg-slate-950/80 border-t border-slate-850 text-[10px] text-slate-500 flex items-center justify-between select-none">
                <span>↑↓ Navegar</span>
                <span>Esc Fechar</span>
              </div>
            </div>
          )}
        </div>

        {/* Code Mini-Map */}
        {showMiniMap && (
          <CodeMiniMap
            code={code}
            textareaRef={textareaRef}
            selectedNode={selectedNode}
          />
        )}
      </div>

      {/* Bottom Status Bar */}
      <div className="h-6 px-3 border-t border-slate-800 bg-[#0a0e16] flex items-center justify-between text-[11px] text-slate-500 shrink-0 font-mono select-none">
        <div className="flex items-center gap-3">
          <span>Parser: tree-sitter ({language})</span>
          <button
            onClick={() => setAutocompleteEnabled((prev) => !prev)}
            className={`flex items-center gap-1 transition ${
              autocompleteEnabled ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-600 hover:text-slate-400'
            }`}
            title="Clique para alternar o autocomplete inteligente"
          >
            <Sparkles className="w-3 h-3" />
            <span>Autocomplete: {autocompleteEnabled ? 'Ativo (Ctrl+Espaço)' : 'Desativado'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span>UTF-8 · LF</span>
        </div>
      </div>
    </div>
  );
}
