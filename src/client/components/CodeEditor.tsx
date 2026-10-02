import React, { useState } from 'react';
import { Code2, Copy, Check, RotateCcw } from 'lucide-react';
import { ASTNode } from '../types';

interface CodeEditorProps {
  code: string;
  language: string;
  filename: string;
  selectedNode: ASTNode | null;
  onChangeCode: (code: string) => void;
  onCopyCode: () => void;
}

export function CodeEditor({
  code,
  language,
  filename,
  selectedNode,
  onChangeCode,
  onCopyCode,
}: CodeEditorProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');

  const highlightStartRow = selectedNode ? selectedNode.startPoint.row : null;
  const highlightEndRow = selectedNode ? selectedNode.endPoint.row : null;

  const handleCopy = () => {
    onCopyCode();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0f18] overflow-hidden">
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
            onClick={handleCopy}
            className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 text-[11px] flex items-center gap-1 transition"
            title="Copiar código para a área de transferência"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>

      {/* Editor Body with Line Numbers */}
      <div className="flex-1 flex overflow-hidden relative font-mono text-xs">
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
        <div className="flex-1 relative overflow-auto p-3">
          <textarea
            value={code}
            onChange={(e) => onChangeCode(e.target.value)}
            placeholder="Digite ou cole seu código-fonte aqui..."
            className="w-full h-full bg-transparent text-slate-200 resize-none focus:outline-none font-mono text-xs leading-5 whitespace-pre selection:bg-cyan-500/30"
            spellCheck={false}
          />
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="h-6 px-3 border-t border-slate-800 bg-[#0a0e16] flex items-center justify-between text-[11px] text-slate-500 shrink-0 font-mono">
        <div>Parser: tree-sitter-language-pack ({language})</div>
        <div>UTF-8 · LF</div>
      </div>
    </div>
  );
}
