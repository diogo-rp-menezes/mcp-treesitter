import React, { useState, useEffect, useMemo } from 'react';
import {
  Code2,
  Search,
  Network,
  BarChart3,
  Terminal,
  FolderTree,
  Play,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  FileCode,
  Server,
  Zap,
  Info,
  GitCompare,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';

interface ASTPosition {
  row: number;
  column: number;
}

interface ASTNode {
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

interface SymbolItem {
  name: string;
  type: string;
  signature?: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  parent?: string;
}

interface CodeComplexity {
  lineCount: number;
  codeLines: number;
  commentLines: number;
  commentRatio: number;
  functionCount: number;
  classCount: number;
  avgFunctionLines: number;
  cyclomaticComplexity: number;
}

interface QueryCapture {
  capture: string;
  text: string;
  nodeType: string;
  startPoint: ASTPosition;
  endPoint: ASTPosition;
}

interface QueryMatch {
  patternIndex: number;
  captures: QueryCapture[];
  matchedText?: string;
}

interface ProjectInfo {
  name: string;
  path: string;
  description?: string;
  fileCount: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<
    'ast' | 'query' | 'symbols' | 'complexity' | 'similarity' | 'mcp' | 'projects'
  >('ast');

  // Project state
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<string>('tree-sitter-core');
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('analyzer.py');

  // Code state
  const [code, setCode] = useState<string>('');
  const [language, setLanguage] = useState<string>('python');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // AST state
  const [ast, setAst] = useState<ASTNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<ASTNode | null>(null);
  const [maxAstDepth, setMaxAstDepth] = useState<number>(5);

  // Query state
  const [queryInput, setQueryInput] = useState<string>(
    `(function_definition\n  name: (identifier) @function.name\n  parameters: (parameters) @function.params\n  body: (block) @function.body) @function.def`
  );
  const [queryMatches, setQueryMatches] = useState<QueryMatch[]>([]);
  const [templates, setTemplates] = useState<Record<string, Record<string, string>>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string>('functions');

  // Symbols state
  const [symbols, setSymbols] = useState<Record<string, SymbolItem[]>>({});
  const [symbolFilter, setSymbolFilter] = useState<string>('all');

  // Complexity state
  const [complexity, setComplexity] = useState<CodeComplexity | null>(null);

  // Similarity state
  const [similaritySnippet, setSimilaritySnippet] = useState<string>(
    `def process_data(items):\n    result = []\n    for item in items:\n        result.append(item.upper())\n    return result`
  );
  const [similarityResults, setSimilarityResults] = useState<any[]>([]);

  // MCP console state
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [selectedMcpTool, setSelectedMcpTool] = useState<string>('get_ast');
  const [mcpToolArgs, setMcpToolArgs] = useState<string>('{}');
  const [mcpOutput, setMcpOutput] = useState<any>(null);
  const [mcpOutputLoading, setMcpOutputLoading] = useState<boolean>(false);
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);

  // Load initial projects & templates
  useEffect(() => {
    fetchProjects();
    fetchTemplates();
    fetchMCPTools();
  }, []);

  // When active project changes, load its files
  useEffect(() => {
    if (activeProject) {
      fetchFiles(activeProject);
    }
  }, [activeProject]);

  // When active file changes, load content
  useEffect(() => {
    if (activeProject && activeFile) {
      loadFileContent(activeProject, activeFile);
    }
  }, [activeProject, activeFile]);

  // Automatically analyze whenever code or language changes
  useEffect(() => {
    if (code) {
      analyzeCode(code, language);
    }
  }, [code, language]);

  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data);
    } catch (err: any) {
      console.error('Failed to load projects', err);
    }
  }

  async function fetchTemplates() {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates', err);
    }
  }

  async function fetchMCPTools() {
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      });
      const data = await res.json();
      if (data?.result?.tools) {
        setMcpTools(data.result.tools);
      }
    } catch (err) {
      console.error('Failed to fetch MCP tools', err);
    }
  }

  async function fetchFiles(projName: string) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projName)}/files`);
      const files: string[] = await res.json();
      setProjectFiles(files);
      if (files.length > 0 && !files.includes(activeFile)) {
        setActiveFile(files[0]);
      }
    } catch (err) {
      console.error('Failed to load files', err);
    }
  }

  async function loadFileContent(projName: string, filePath: string) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projName)}/file?path=${encodeURIComponent(filePath)}`
      );
      if (!res.ok) throw new Error('Could not load file');
      const fileData = await res.json();
      setCode(fileData.content || '');
      setLanguage(fileData.language || 'python');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function analyzeCode(src: string, lang: string) {
    try {
      // 1. AST
      const astRes = await fetch('/api/ast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: src, language: lang }),
      });
      const astData = await astRes.json();
      setAst(astData);

      // 2. Symbols
      const symRes = await fetch('/api/symbols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: src, language: lang }),
      });
      const symData = await symRes.json();
      setSymbols(symData);

      // 3. Complexity
      const compRes = await fetch('/api/complexity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: src, language: lang }),
      });
      const compData = await compRes.json();
      setComplexity(compData);
    } catch (err: any) {
      console.error('Analysis error:', err);
    }
  }

  async function handleRunQuery() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryInput,
          code,
          language,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setQueryMatches(data);
    } catch (err: any) {
      setErrorMsg('Query execution error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectTemplate(tplName: string) {
    setSelectedTemplate(tplName);
    const langTemplates = templates[language] || templates['python'] || {};
    if (langTemplates[tplName]) {
      setQueryInput(langTemplates[tplName]);
    }
  }

  async function handleFindSimilar() {
    setLoading(true);
    try {
      const res = await fetch('/api/similarity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: similaritySnippet,
          language,
          project: activeProject,
          threshold: 0.4,
        }),
      });
      const data = await res.json();
      setSimilarityResults(data);
    } catch (err: any) {
      setErrorMsg('Similarity search error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExecuteMCPTool() {
    setMcpOutputLoading(true);
    try {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(mcpToolArgs);
      } catch (e) {
        parsedArgs = {};
      }

      // Default contextual parameters if missing
      const finalArgs: Record<string, any> = {
        project: activeProject,
        file_path: activeFile,
        path: activeFile,
        code,
        language,
        ...parsedArgs,
      };

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: selectedMcpTool,
            arguments: finalArgs,
          },
        }),
      });
      const data = await res.json();
      setMcpOutput(data);
    } catch (err: any) {
      setMcpOutput({ error: err.message });
    } finally {
      setMcpOutputLoading(false);
    }
  }

  async function handleSaveCurrentFile() {
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile, content: code }),
      });
      alert(`Saved ${activeFile}`);
    } catch (e) {
      console.error(e);
    }
  }

  // Count total symbols
  const totalSymbolsCount = useMemo(() => {
    return Object.values(symbols).reduce((acc, list) => acc + (list?.length || 0), 0);
  }, [symbols]);

  // MCP Desktop config snippet
  const mcpConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        'tree-sitter': {
          command: 'npx',
          args: ['-y', 'mcp-server-tree-sitter'],
          env: {
            MCP_TS_CONFIG_PATH: '~/.config/tree-sitter/config.yaml',
          },
        },
        'tree-sitter-http': {
          url: `${window.location.origin}/api/mcp`,
        },
      },
    },
    null,
    2
  );

  return (
    <div className="flex flex-col h-screen bg-[#0b0f17] text-slate-100 overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-14 border-b border-slate-800 bg-[#0d131f] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm tracking-wide text-white">MCP Tree-sitter Server</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                v0.7.0
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Port 3000 Ready
              </span>
            </div>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-3">
          {/* Project selector */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden sm:inline">Project:</span>
            <select
              value={activeProject}
              onChange={(e) => setActiveProject(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
            >
              {projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.fileCount} files)
                </option>
              ))}
            </select>
          </div>

          {/* File selector */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden sm:inline">File:</span>
            <select
              value={activeFile}
              onChange={(e) => setActiveFile(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
            >
              {projectFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          {/* Language badge */}
          <span className="text-xs px-2.5 py-1 bg-slate-800 rounded border border-slate-700 text-cyan-300 font-mono uppercase">
            {language}
          </span>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <nav className="h-10 border-b border-slate-800 bg-[#0f172a] px-4 flex items-center gap-1 shrink-0 overflow-x-auto">
        <button
          onClick={() => setActiveTab('ast')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
            activeTab === 'ast'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          AST Explorer
        </button>

        <button
          onClick={() => setActiveTab('query')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
            activeTab === 'query'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Search className="w-3.5 h-3.5" />
          Query Playground
        </button>

        <button
          onClick={() => setActiveTab('symbols')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
            activeTab === 'symbols'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <FileCode className="w-3.5 h-3.5" />
          Symbols ({totalSymbolsCount})
        </button>

        <button
          onClick={() => setActiveTab('complexity')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
            activeTab === 'complexity'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Complexity Metrics
        </button>

        <button
          onClick={() => setActiveTab('similarity')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
            activeTab === 'similarity'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <GitCompare className="w-3.5 h-3.5" />
          AST Similarity
        </button>

        <button
          onClick={() => setActiveTab('mcp')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
            activeTab === 'mcp'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          MCP Protocol Console
        </button>

        <button
          onClick={() => setActiveTab('projects')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
            activeTab === 'projects'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" />
          Files & Projects
        </button>
      </nav>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Code Editor (shared across most views) */}
        {activeTab !== 'projects' && activeTab !== 'mcp' && (
          <div className="w-1/2 border-r border-slate-800 flex flex-col bg-[#0b0f17]">
            <div className="h-9 px-3 border-b border-slate-800 bg-[#0e1422] flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-cyan-400" />
                <span className="font-mono text-slate-200">{activeFile}</span>
                <span className="text-[11px] text-slate-500">({code.split('\n').length} lines)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveCurrentFile}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-[11px] transition"
                >
                  Save File
                </button>
              </div>
            </div>

            <div className="flex-1 relative overflow-auto p-3 font-mono text-xs leading-relaxed">
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste or write source code here..."
                className="w-full h-full bg-transparent text-slate-100 resize-none focus:outline-none font-mono selection:bg-cyan-500/30 whitespace-pre"
                spellCheck={false}
              />
            </div>

            {/* Quick status bar */}
            <div className="h-6 px-3 border-t border-slate-800 bg-[#0d131f] flex items-center justify-between text-[11px] text-slate-500">
              <div>Syntax Parser: Tree-sitter AST Engine</div>
              <div>Language: {language}</div>
            </div>
          </div>
        )}

        {/* Right Panel: View Specific Content */}
        <div
          className={`${
            activeTab === 'projects' || activeTab === 'mcp' ? 'w-full' : 'w-1/2'
          } flex flex-col bg-[#0f172a] overflow-hidden`}
        >
          {/* TAB 1: AST Explorer */}
          {activeTab === 'ast' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-9 px-3 border-b border-slate-800 bg-[#11192e] flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span className="font-medium text-slate-200">Abstract Syntax Tree (AST)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span>Max Depth:</span>
                  <select
                    value={maxAstDepth}
                    onChange={(e) => setMaxAstDepth(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300 text-xs"
                  >
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={5}>5</option>
                    <option value={8}>8</option>
                    <option value={15}>15 (All)</option>
                  </select>
                </div>
              </div>

              {/* AST Tree and Detail Split */}
              <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* Visual Tree */}
                <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                  {ast ? (
                    <ASTNodeTree
                      node={ast}
                      currentDepth={0}
                      maxDepth={maxAstDepth}
                      selectedNode={selectedNode}
                      onSelectNode={(node) => setSelectedNode(node)}
                    />
                  ) : (
                    <div className="text-slate-500 italic p-4">Parsing AST...</div>
                  )}
                </div>

                {/* Node Detail Inspector */}
                <div className="w-full md:w-72 border-t md:border-t-0 md:border-l border-slate-800 bg-[#0d131f] p-3 text-xs overflow-auto">
                  <h4 className="font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-cyan-400" />
                    Node Inspector
                  </h4>
                  {selectedNode ? (
                    <div className="space-y-2">
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <div className="text-slate-400 text-[11px]">Type</div>
                        <div className="font-mono text-cyan-300 font-medium">{selectedNode.type}</div>
                      </div>
                      {selectedNode.field && (
                        <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                          <div className="text-slate-400 text-[11px]">Field Name</div>
                          <div className="font-mono text-amber-300">{selectedNode.field}</div>
                        </div>
                      )}
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <div className="text-slate-400 text-[11px]">Range (Row : Col)</div>
                        <div className="font-mono text-slate-200">
                          {selectedNode.startPoint.row}:{selectedNode.startPoint.column} →{' '}
                          {selectedNode.endPoint.row}:{selectedNode.endPoint.column}
                        </div>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <div className="text-slate-400 text-[11px]">Byte Range</div>
                        <div className="font-mono text-slate-200">
                          {selectedNode.startByte} .. {selectedNode.endByte} ({selectedNode.endByte - selectedNode.startByte} bytes)
                        </div>
                      </div>
                      {selectedNode.text && (
                        <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                          <div className="text-slate-400 text-[11px] mb-1">Snippet</div>
                          <pre className="font-mono text-[11px] bg-slate-950 p-2 rounded overflow-x-auto text-emerald-300 whitespace-pre-wrap max-h-36">
                            {selectedNode.text}
                          </pre>
                        </div>
                      )}
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <div className="text-slate-400 text-[11px]">Children Count</div>
                        <div className="font-mono text-slate-200">{selectedNode.children?.length || 0} nodes</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-500 italic p-3 text-center border border-dashed border-slate-800 rounded">
                      Click any node in the tree to inspect details and source coordinates.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Query Playground */}
          {activeTab === 'query' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-9 px-3 border-b border-slate-800 bg-[#11192e] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-cyan-400" />
                  <span className="font-medium text-slate-200">Tree-sitter Query Runner</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs">Templates:</span>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 text-xs"
                  >
                    {Object.keys(templates[language] || templates['python'] || {}).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleRunQuery}
                    disabled={loading}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs flex items-center gap-1 font-medium transition shadow-sm"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    Execute Query
                  </button>
                </div>
              </div>

              {/* S-expression Query Editor */}
              <div className="h-44 border-b border-slate-800 bg-[#0d131f] p-2.5 font-mono text-xs flex flex-col">
                <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                  <span>S-Expression Pattern (Tree-sitter syntax):</span>
                  <span className="text-cyan-400/80">Support for @captures, fields, predicates (#eq?)</span>
                </div>
                <textarea
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  className="flex-1 bg-slate-950 text-slate-100 p-2 rounded border border-slate-800 resize-none font-mono focus:outline-none focus:border-cyan-500/50"
                  spellCheck={false}
                />
              </div>

              {/* Query Results */}
              <div className="flex-1 overflow-auto p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-slate-300">
                    Query Matches ({queryMatches.length} found)
                  </h4>
                </div>

                {errorMsg && (
                  <div className="p-2 mb-2 bg-red-950/40 border border-red-800/60 rounded text-red-300 text-xs">
                    {errorMsg}
                  </div>
                )}

                {queryMatches.length === 0 ? (
                  <div className="text-slate-500 italic p-6 text-center border border-dashed border-slate-800 rounded">
                    No matches or query not yet executed. Click "Execute Query" above.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {queryMatches.map((m, idx) => (
                      <div key={idx} className="bg-slate-900 border border-slate-800 rounded p-2.5">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-[11px] font-semibold text-slate-400">Match #{idx + 1}</span>
                          {m.captures.map((cap, cIdx) => (
                            <span
                              key={cIdx}
                              className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-950 border border-cyan-800/80 text-cyan-300 font-mono"
                            >
                              @{cap.capture} ({cap.nodeType})
                            </span>
                          ))}
                        </div>

                        {/* Capture details */}
                        <div className="space-y-1 font-mono text-[11px]">
                          {m.captures.map((cap, cIdx) => (
                            <div key={cIdx} className="bg-slate-950/80 p-1.5 rounded flex items-start gap-2">
                              <span className="text-amber-400 shrink-0">@{cap.capture}:</span>
                              <span className="text-emerald-300 break-all">{cap.text}</span>
                              <span className="text-slate-500 ml-auto shrink-0 text-[10px]">
                                L{cap.startPoint.row + 1}:C{cap.startPoint.column}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Symbol Inspector */}
          {activeTab === 'symbols' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-9 px-3 border-b border-slate-800 bg-[#11192e] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-cyan-400" />
                  <span className="font-medium text-slate-200">Extracted AST Symbols</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs">Filter:</span>
                  <select
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 text-xs"
                  >
                    <option value="all">All Symbols ({totalSymbolsCount})</option>
                    <option value="functions">Functions ({symbols.functions?.length || 0})</option>
                    <option value="classes">Classes ({symbols.classes?.length || 0})</option>
                    <option value="imports">Imports ({symbols.imports?.length || 0})</option>
                    <option value="interfaces">Interfaces ({symbols.interfaces?.length || 0})</option>
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-3 text-xs space-y-3">
                {/* Functions */}
                {(symbolFilter === 'all' || symbolFilter === 'functions') && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                      Functions & Methods ({symbols.functions?.length || 0})
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                      {symbols.functions?.map((f, idx) => (
                        <div key={idx} className="bg-slate-900 p-2.5 rounded border border-slate-800 flex items-center justify-between">
                          <div>
                            <div className="font-mono text-cyan-300 font-semibold">{f.name}</div>
                            {f.signature && (
                              <div className="font-mono text-slate-400 text-[11px]">{f.signature}</div>
                            )}
                            {f.parent && <div className="text-[10px] text-slate-500">Parent: {f.parent}</div>}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            Lines {f.startLine + 1} - {f.endLine + 1}
                          </div>
                        </div>
                      ))}
                      {(!symbols.functions || symbols.functions.length === 0) && (
                        <div className="text-slate-500 italic p-2 text-xs">No functions detected</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Classes */}
                {(symbolFilter === 'all' || symbolFilter === 'classes') && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      Classes & Structs ({symbols.classes?.length || 0})
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                      {symbols.classes?.map((c, idx) => (
                        <div key={idx} className="bg-slate-900 p-2.5 rounded border border-slate-800 flex items-center justify-between">
                          <div>
                            <div className="font-mono text-amber-300 font-semibold">{c.name}</div>
                            <div className="text-[11px] text-slate-400">{c.type}</div>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            Lines {c.startLine + 1} - {c.endLine + 1}
                          </div>
                        </div>
                      ))}
                      {(!symbols.classes || symbols.classes.length === 0) && (
                        <div className="text-slate-500 italic p-2 text-xs">No classes detected</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Imports */}
                {(symbolFilter === 'all' || symbolFilter === 'imports') && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                      Imports & Dependencies ({symbols.imports?.length || 0})
                    </h4>
                    <div className="space-y-1">
                      {symbols.imports?.map((imp, idx) => (
                        <div key={idx} className="bg-slate-900 p-2 rounded border border-slate-800 font-mono text-[11px] text-purple-300 flex justify-between">
                          <span>{imp.name}</span>
                          <span className="text-slate-500">Line {imp.startLine + 1}</span>
                        </div>
                      ))}
                      {(!symbols.imports || symbols.imports.length === 0) && (
                        <div className="text-slate-500 italic p-2 text-xs">No imports detected</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: Complexity Metrics */}
          {activeTab === 'complexity' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-9 px-3 border-b border-slate-800 bg-[#11192e] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  <span className="font-medium text-slate-200">Code Complexity & AST Metrics</span>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 space-y-4">
                {complexity ? (
                  <>
                    {/* Top KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">Cyclomatic Complexity</div>
                        <div className="text-2xl font-bold font-mono text-cyan-400">
                          {complexity.cyclomaticComplexity}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          {complexity.cyclomaticComplexity < 10
                            ? 'Simple & Low Risk'
                            : complexity.cyclomaticComplexity < 20
                            ? 'Moderate Complexity'
                            : 'High Complexity (refactor)'}
                        </div>
                      </div>

                      <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">Total Lines of Code</div>
                        <div className="text-2xl font-bold font-mono text-slate-200">
                          {complexity.lineCount}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          {complexity.codeLines} code lines
                        </div>
                      </div>

                      <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">Functions Declared</div>
                        <div className="text-2xl font-bold font-mono text-emerald-400">
                          {complexity.functionCount}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          Avg {complexity.avgFunctionLines} lines / func
                        </div>
                      </div>

                      <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">Comment Ratio</div>
                        <div className="text-2xl font-bold font-mono text-purple-400">
                          {(complexity.commentRatio * 100).toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          {complexity.commentLines} comment lines
                        </div>
                      </div>
                    </div>

                    {/* Breakdown bars */}
                    <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-3">
                      <h4 className="text-xs font-semibold text-slate-300">Code Distribution</h4>
                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>Executable Code vs Documentation</span>
                          <span>
                            {complexity.codeLines} code / {complexity.commentLines} comments
                          </span>
                        </div>
                        <div className="h-3 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
                          <div
                            className="bg-cyan-500 h-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (complexity.codeLines / Math.max(1, complexity.lineCount)) * 100
                              )}%`,
                            }}
                          />
                          <div
                            className="bg-purple-500 h-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (complexity.commentLines / Math.max(1, complexity.lineCount)) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Architectural Health info */}
                    <div className="bg-slate-900/60 p-4 rounded-lg border border-slate-800 text-xs space-y-2">
                      <div className="font-semibold text-slate-200">AST Analysis Insights</div>
                      <p className="text-slate-400 leading-relaxed">
                        This file contains {complexity.classCount} class/struct definitions and{' '}
                        {complexity.functionCount} functions with a calculated cyclomatic complexity of{' '}
                        {complexity.cyclomaticComplexity}. Tree-sitter AST queries can pinpoint nested branch
                        points and verify adherence to styling and structure.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500 italic p-6 text-center">Calculating metrics...</div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: Code Similarity */}
          {activeTab === 'similarity' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-9 px-3 border-b border-slate-800 bg-[#11192e] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <GitCompare className="w-4 h-4 text-cyan-400" />
                  <span className="font-medium text-slate-200">AST Fingerprint & Structural Similarity</span>
                </div>
                <button
                  onClick={handleFindSimilar}
                  disabled={loading}
                  className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs flex items-center gap-1 font-medium transition"
                >
                  <Search className="w-3 h-3" />
                  Compare ASTs
                </button>
              </div>

              <div className="p-3 bg-[#0d131f] border-b border-slate-800 text-xs">
                <div className="text-slate-400 text-[11px] mb-1">
                  Target Snippet to Match Against Project Files (Uses AST Jaccard Similarity):
                </div>
                <textarea
                  value={similaritySnippet}
                  onChange={(e) => setSimilaritySnippet(e.target.value)}
                  className="w-full h-24 bg-slate-950 font-mono text-xs p-2 rounded border border-slate-800 text-slate-200 resize-none focus:outline-none focus:border-cyan-500"
                  spellCheck={false}
                />
              </div>

              <div className="flex-1 overflow-auto p-3 text-xs space-y-2">
                <h4 className="font-semibold text-slate-300">
                  Similar Code Matches ({similarityResults.length})
                </h4>

                {similarityResults.length === 0 ? (
                  <div className="text-slate-500 italic p-6 text-center border border-dashed border-slate-800 rounded">
                    Click "Compare ASTs" to scan project files for structurally identical or similar code blocks.
                  </div>
                ) : (
                  similarityResults.map((r, idx) => (
                    <div key={idx} className="bg-slate-900 border border-slate-800 rounded p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-cyan-400 font-medium">{r.filePath}</span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-950 border border-emerald-800 text-emerald-300 font-mono">
                          Score: {(r.score * 100).toFixed(0)}% Match
                        </span>
                      </div>
                      <div className="text-slate-400 text-[11px]">
                        Lines {r.lineStart + 1} to {r.lineEnd + 1}
                      </div>
                      <pre className="bg-slate-950 p-2 rounded text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre">
                        {r.matchedSnippet}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 6: MCP Protocol Console */}
          {activeTab === 'mcp' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-9 px-4 border-b border-slate-800 bg-[#11192e] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  <span className="font-medium text-slate-200">Model Context Protocol (MCP) Live Console</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    JSON-RPC 2.0 active at /api/mcp
                  </span>
                </div>
              </div>

              <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* Tool Selection and Invocation */}
                <div className="w-full md:w-1/2 p-4 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col space-y-3 overflow-auto">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Registered MCP Tool:
                    </label>
                    <select
                      value={selectedMcpTool}
                      onChange={(e) => setSelectedMcpTool(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    >
                      {mcpTools.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name} — {t.description}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Tool Arguments (JSON):
                    </label>
                    <textarea
                      value={mcpToolArgs}
                      onChange={(e) => setMcpToolArgs(e.target.value)}
                      placeholder="{}"
                      className="w-full h-32 bg-slate-950 font-mono text-xs p-2.5 rounded border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                      spellCheck={false}
                    />
                    <div className="text-[10px] text-slate-500 mt-1">
                      Context params (active project, file, code, and language) are automatically injected if omitted.
                    </div>
                  </div>

                  <button
                    onClick={handleExecuteMCPTool}
                    disabled={mcpOutputLoading}
                    className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium flex items-center justify-center gap-2 transition shadow"
                  >
                    {mcpOutputLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    Send MCP JSON-RPC Request
                  </button>

                  {/* Connect Claude Desktop / Cursor modal card */}
                  <div className="mt-4 p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-cyan-400" />
                        Claude Desktop & Client Config
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(mcpConfigSnippet);
                          setCopiedConfig(true);
                          setTimeout(() => setCopiedConfig(false), 2000);
                        }}
                        className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
                      >
                        {copiedConfig ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedConfig ? 'Copied' : 'Copy Config'}
                      </button>
                    </div>
                    <pre className="bg-slate-950 p-2 rounded text-[10px] font-mono text-slate-300 overflow-x-auto">
                      {mcpConfigSnippet}
                    </pre>
                  </div>
                </div>

                {/* Response Viewer */}
                <div className="w-full md:w-1/2 p-4 flex flex-col bg-[#0b0f17] overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300">MCP JSON-RPC Response:</span>
                    {mcpOutput && (
                      <button
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(mcpOutput, null, 2))}
                        className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> Copy Output
                      </button>
                    )}
                  </div>
                  <pre className="flex-1 bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs font-mono text-emerald-300 overflow-auto whitespace-pre">
                    {mcpOutput
                      ? JSON.stringify(mcpOutput, null, 2)
                      : '// Response payload will appear here after tool invocation.'}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: Files & Projects Manager */}
          {activeTab === 'projects' && (
            <div className="flex-1 flex flex-col p-6 overflow-auto">
              <div className="max-w-4xl w-full mx-auto space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Projects & Files Workspace</h3>
                    <p className="text-xs text-slate-400">
                      Manage registered projects and source files parsed by the Tree-sitter engine.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const name = prompt('Enter new project name:');
                      if (name) {
                        fetch('/api/projects', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name }),
                        }).then(() => fetchProjects());
                      }
                    }}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs flex items-center gap-1 font-medium transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Project
                  </button>
                </div>

                {/* Projects list */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projects.map((p) => (
                    <div
                      key={p.name}
                      className={`p-4 rounded-lg border transition cursor-pointer ${
                        activeProject === p.name
                          ? 'bg-slate-900 border-cyan-500/60 shadow-lg shadow-cyan-950/20'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                      onClick={() => setActiveProject(p.name)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-semibold text-sm text-slate-200 flex items-center gap-2">
                            <FolderTree className="w-4 h-4 text-cyan-400" />
                            {p.name}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">{p.description}</div>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                          {p.fileCount} files
                        </span>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                        <span className="font-mono text-[11px] text-slate-500">{p.path}</span>
                        {activeProject === p.name && (
                          <span className="text-cyan-400 text-[11px] font-medium">Active Project</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Files in Active Project */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm text-slate-200">
                      Files in <span className="text-cyan-400">{activeProject}</span>
                    </h4>
                    <button
                      onClick={() => {
                        const path = prompt('Enter file path (e.g. main.py, helper.ts):');
                        if (path) {
                          fetch(`/api/projects/${encodeURIComponent(activeProject)}/file`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path, content: '# New file\n' }),
                          }).then(() => {
                            fetchFiles(activeProject);
                            setActiveFile(path);
                          });
                        }
                      }}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs flex items-center gap-1 transition"
                    >
                      <Plus className="w-3 h-3" /> Add File
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {projectFiles.map((f) => (
                      <div
                        key={f}
                        onClick={() => {
                          setActiveFile(f);
                          setActiveTab('ast');
                        }}
                        className={`p-2.5 rounded border text-xs flex items-center justify-between cursor-pointer transition ${
                          activeFile === f
                            ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-200'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-mono truncate">{f}</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Collapsible AST Tree Node Component
function ASTNodeTree({
  node,
  currentDepth,
  maxDepth,
  selectedNode,
  onSelectNode,
}: {
  node: ASTNode;
  currentDepth: number;
  maxDepth: number;
  selectedNode: ASTNode | null;
  onSelectNode: (node: ASTNode) => void;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(currentDepth >= maxDepth);
  const isSelected = selectedNode?.id === node.id;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="pl-3 border-l border-slate-800/80 my-0.5">
      <div
        onClick={() => onSelectNode(node)}
        className={`flex items-center gap-1.5 py-0.5 px-1.5 rounded cursor-pointer transition ${
          isSelected
            ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
            : 'hover:bg-slate-800/50 text-slate-300'
        }`}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
            className="p-0.5 hover:text-white text-slate-500"
          >
            {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        {node.field && <span className="text-amber-400 font-mono text-[11px]">{node.field}:</span>}
        <span className="font-mono text-cyan-400 font-medium text-[11px]">({node.type})</span>

        <span className="text-[10px] text-slate-500 font-mono">
          [{node.startPoint.row}:{node.startPoint.column}]
        </span>

        {node.text && node.text.length <= 25 && !hasChildren && (
          <span className="text-emerald-300 font-mono text-[11px] truncate bg-slate-950 px-1 rounded">
            "{node.text.trim()}"
          </span>
        )}
      </div>

      {!collapsed && hasChildren && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <ASTNodeTree
              key={child.id}
              node={child}
              currentDepth={currentDepth + 1}
              maxDepth={maxDepth}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
