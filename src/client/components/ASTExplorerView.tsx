import React, { useState, useMemo } from 'react';
import {
  Layers,
  ChevronRight,
  ChevronDown,
  Info,
  Search,
  Maximize2,
  Minimize2,
  Copy,
  Check,
} from 'lucide-react';
import { ASTNode } from '../types';

interface ASTExplorerViewProps {
  ast: ASTNode | null;
  selectedNode: ASTNode | null;
  maxDepth: number;
  onChangeMaxDepth: (depth: number) => void;
  onSelectNode: (node: ASTNode) => void;
}

export function ASTExplorerView({
  ast,
  selectedNode,
  maxDepth,
  onChangeMaxDepth,
  onSelectNode,
}: ASTExplorerViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedNode, setCopiedNode] = useState(false);
  const [forceExpand, setForceExpand] = useState<boolean | null>(null);

  const handleCopyNodeJSON = () => {
    if (!selectedNode) return;
    navigator.clipboard.writeText(JSON.stringify(selectedNode, null, 2));
    setCopiedNode(true);
    setTimeout(() => setCopiedNode(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0f172a] overflow-hidden">
      {/* View Header with Controls */}
      <div className="h-10 px-3 border-b border-slate-800 bg-[#11192e] flex items-center justify-between text-xs shrink-0 select-none">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-slate-200">Árvore Sintática Abstrata (AST)</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Search filter in AST */}
          <div className="relative w-44">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar nó por tipo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded pl-7 pr-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Depth control */}
          <div className="flex items-center gap-1.5 text-slate-400 text-xs">
            <span className="hidden sm:inline">Nível:</span>
            <select
              value={maxDepth}
              onChange={(e) => {
                onChangeMaxDepth(Number(e.target.value));
                setForceExpand(null);
              }}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 text-xs focus:outline-none focus:border-cyan-500"
            >
              <option value={2}>2 (Topo)</option>
              <option value={3}>3 (Médio)</option>
              <option value={5}>5 (Padrão)</option>
              <option value={8}>8 (Profundo)</option>
              <option value={15}>15 (Completo)</option>
            </select>
          </div>

          {/* Expand / Collapse buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setForceExpand(true)}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
              title="Expandir todos os nós"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setForceExpand(false)}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
              title="Recolher nós"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split: Tree + Node Detail */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Interactive AST Tree */}
        <div className="flex-1 overflow-auto p-3 font-mono text-xs">
          {ast ? (
            <TreeNode
              node={ast}
              depth={0}
              maxDepth={maxDepth}
              forceExpand={forceExpand}
              searchTerm={searchTerm.toLowerCase()}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
            />
          ) : (
            <div className="text-slate-500 italic p-6 text-center">Gerando árvore AST...</div>
          )}
        </div>

        {/* Right Side: Node Inspector Card */}
        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 bg-[#0d131f] p-3 text-xs overflow-auto flex flex-col justify-between shrink-0">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
              <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-cyan-400" />
                Inspetor do Nó
              </h4>
              {selectedNode && (
                <button
                  onClick={handleCopyNodeJSON}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 text-[11px] flex items-center gap-1 transition"
                >
                  {copiedNode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedNode ? 'Copiado!' : 'Copiar JSON'}
                </button>
              )}
            </div>

            {selectedNode ? (
              <div className="space-y-2.5">
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-0.5">Tipo do Nó Tree-sitter</div>
                  <div className="font-mono text-cyan-300 font-semibold text-sm">{selectedNode.type}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {selectedNode.isNamed ? 'Nó Nomeado (Sintático)' : 'Nó Anônimo (Token Literário)'}
                  </div>
                </div>

                {selectedNode.field && (
                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-slate-400 text-[11px] mb-0.5">Nome do Campo (Field)</div>
                    <div className="font-mono text-amber-300 font-medium">{selectedNode.field}</div>
                  </div>
                )}

                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-0.5">Posição no Código</div>
                  <div className="font-mono text-slate-200 text-xs">
                    Linha {selectedNode.startPoint.row + 1}, Coluna {selectedNode.startPoint.column}
                    {' → '}
                    Linha {selectedNode.endPoint.row + 1}, Coluna {selectedNode.endPoint.column}
                  </div>
                </div>

                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-0.5">Intervalo em Bytes</div>
                  <div className="font-mono text-slate-300 text-xs">
                    Byte {selectedNode.startByte} até {selectedNode.endByte} (
                    {selectedNode.endByte - selectedNode.startByte} bytes)
                  </div>
                </div>

                {selectedNode.text && (
                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-slate-400 text-[11px] mb-1">Conteúdo do Trecho</div>
                    <pre className="font-mono text-[11px] bg-slate-950 p-2 rounded overflow-x-auto text-emerald-300 whitespace-pre-wrap max-h-44 border border-slate-850">
                      {selectedNode.text}
                    </pre>
                  </div>
                )}

                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 flex justify-between items-center">
                  <span className="text-slate-400 text-[11px]">Nós Filhos Diretos</span>
                  <span className="font-mono text-cyan-400 font-semibold">
                    {selectedNode.children?.length || 0}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-slate-500 italic p-4 text-center border border-dashed border-slate-800 rounded-lg">
                Selecione qualquer nó na árvore à esquerda para inspecionar os detalhes e coordenadas exatas.
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 text-center">
            Clique no nó para destacar a linha no editor de código.
          </div>
        </div>
      </div>
    </div>
  );
}

// Recursive Tree Node with Highlight and Collapsing
function TreeNode({
  node,
  depth,
  maxDepth,
  forceExpand,
  searchTerm,
  selectedNode,
  onSelectNode,
}: {
  node: ASTNode;
  depth: number;
  maxDepth: number;
  forceExpand: boolean | null;
  searchTerm: string;
  selectedNode: ASTNode | null;
  onSelectNode: (node: ASTNode) => void;
}) {
  const isSelected = selectedNode?.id === node.id;
  const hasChildren = node.children && node.children.length > 0;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (forceExpand !== null) return !forceExpand;
    return depth >= maxDepth;
  });

  React.useEffect(() => {
    if (forceExpand !== null) {
      setCollapsed(!forceExpand);
    }
  }, [forceExpand]);

  // Check if matches search
  const isSearchMatch =
    searchTerm.length > 0 &&
    (node.type.toLowerCase().includes(searchTerm) ||
      (node.field && node.field.toLowerCase().includes(searchTerm)) ||
      (node.text && node.text.toLowerCase().includes(searchTerm)));

  // Color coding by node category
  let badgeColor = 'text-cyan-400 bg-cyan-950/40 border-cyan-800/40';
  if (node.type.includes('definition') || node.type.includes('declaration')) {
    badgeColor = 'text-blue-400 bg-blue-950/40 border-blue-800/40';
  } else if (node.type.includes('statement') || node.type === 'block') {
    badgeColor = 'text-purple-400 bg-purple-950/40 border-purple-800/40';
  } else if (node.type.includes('identifier')) {
    badgeColor = 'text-amber-400 bg-amber-950/40 border-amber-800/40';
  } else if (node.type.includes('comment')) {
    badgeColor = 'text-slate-400 bg-slate-900 border-slate-800';
  }

  return (
    <div className="pl-3 border-l border-slate-800/70 my-0.5 font-mono text-xs">
      <div
        onClick={() => onSelectNode(node)}
        className={`flex items-center gap-1.5 py-0.5 px-2 rounded-md cursor-pointer transition select-none ${
          isSelected
            ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/50 shadow-sm'
            : isSearchMatch
            ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
            : 'hover:bg-slate-800/60 text-slate-300'
        }`}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
            className="p-0.5 hover:text-white text-slate-500 transition"
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        {node.field && <span className="text-amber-400 font-semibold">{node.field}:</span>}

        <span className={`px-1.5 py-0.5 rounded text-[11px] border font-medium ${badgeColor}`}>
          ({node.type})
        </span>

        <span className="text-[10px] text-slate-500">
          [{node.startPoint.row + 1}:{node.startPoint.column}]
        </span>

        {node.text && node.text.length <= 30 && !hasChildren && (
          <span className="text-emerald-300 text-[11px] truncate bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-850">
            "{node.text.trim()}"
          </span>
        )}
      </div>

      {!collapsed && hasChildren && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              forceExpand={forceExpand}
              searchTerm={searchTerm}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
