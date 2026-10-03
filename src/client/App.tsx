import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar, NavTab } from './components/Sidebar';
import { CodeEditor } from './components/CodeEditor';
import { ASTExplorerView } from './components/ASTExplorerView';
import { QueryStudioView } from './components/QueryStudioView';
import { SymbolsView } from './components/SymbolsView';
import { ComplexityView } from './components/ComplexityView';
import { SimilarityView } from './components/SimilarityView';
import { MCPConsoleView } from './components/MCPConsoleView';
import { ProjectManagerView } from './components/ProjectManagerView';
import { BreadcrumbBar } from './components/BreadcrumbBar';
import { MCPConnectModal } from './components/MCPConnectModal';
import { Toast } from './components/Toast';
import {
  ASTNode,
  SymbolItem,
  CodeComplexity,
  QueryMatch,
  ProjectInfo,
  PresetSnippet,
  PRESET_SNIPPETS,
} from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('ast');

  // Project state
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<string>('tree-sitter-core');
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('analyzer.py');

  // Code editor state
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

  // Complexity state
  const [complexity, setComplexity] = useState<CodeComplexity | null>(null);

  // Similarity state
  const [similaritySnippet, setSimilaritySnippet] = useState<string>(
    `def process_data(items):\n    result = []\n    for item in items:\n        result.append(item.upper())\n    return result`
  );
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.4);
  const [similarityResults, setSimilarityResults] = useState<any[]>([]);

  // MCP console state
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [selectedMcpTool, setSelectedMcpTool] = useState<string>('get_ast');
  const [mcpOutput, setMcpOutput] = useState<any>(null);
  const [mcpLoading, setMcpLoading] = useState<boolean>(false);

  // UI helpers
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMCPModalOpen, setIsMCPModalOpen] = useState<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  // Fetch initial project data, templates, and tools
  useEffect(() => {
    fetchProjects();
    fetchTemplates();
    fetchMCPTools();
  }, []);

  // Load project files when active project changes
  useEffect(() => {
    if (activeProject) {
      fetchFiles(activeProject);
    }
  }, [activeProject]);

  // Load file content when file changes
  useEffect(() => {
    if (activeProject && activeFile) {
      loadFileContent(activeProject, activeFile);
    }
  }, [activeProject, activeFile]);

  // Real-time analysis whenever code or language changes with AbortController
  useEffect(() => {
    if (!code) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      analyzeCode(code, language, controller.signal);
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, language]);

  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data);
    } catch (err) {
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

  async function analyzeCode(src: string, lang: string, signal?: AbortSignal) {
    try {
      // 1. AST
      const astRes = await fetch('/api/ast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: src, language: lang }),
        signal,
      });
      if (signal?.aborted) return;
      const astData = await astRes.json();
      setAst(astData);

      // 2. Symbols
      const symRes = await fetch('/api/symbols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: src, language: lang }),
        signal,
      });
      if (signal?.aborted) return;
      const symData = await symRes.json();
      setSymbols(symData);

      // 3. Complexity
      const compRes = await fetch('/api/complexity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: src, language: lang }),
        signal,
      });
      if (signal?.aborted) return;
      const compData = await compRes.json();
      setComplexity(compData);
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        // Request intentionally aborted by newer keystroke
        return;
      }
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
      showToast(`Consulta executada: ${data.length} nós correspondentes encontrados!`);
    } catch (err: any) {
      setErrorMsg('Erro na execução da query: ' + err.message);
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
          threshold: similarityThreshold,
        }),
      });
      const data = await res.json();
      setSimilarityResults(data);
      showToast(`Comparação concluída: ${data.length} trechos similares localizados.`);
    } catch (err: any) {
      setErrorMsg('Erro na comparação: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExecuteMCPTool(toolName: string, args: Record<string, any>) {
    setMcpLoading(true);
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      });
      const data = await res.json();
      setMcpOutput(data);
      showToast(`Ferramenta MCP '${toolName}' executada com sucesso!`);
    } catch (err: any) {
      setMcpOutput({ error: err.message });
      showToast('Erro ao invocar ferramenta MCP.');
    } finally {
      setMcpLoading(false);
    }
  }

  async function handleSaveCurrentFile() {
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile, content: code }),
      });
      showToast(`Arquivo '${activeFile}' salvo com sucesso!`);
    } catch (e: any) {
      showToast('Falha ao salvar arquivo: ' + e.message);
    }
  }

  function handleLoadPreset(preset: PresetSnippet) {
    setCode(preset.code);
    setLanguage(preset.language);
    setActiveFile(preset.filename);
    setSelectedNode(null);
    showToast(`Exemplo carregado: ${preset.name}`);
  }

  const totalSymbolsCount = useMemo(() => {
    return Object.values(symbols).reduce((acc, list) => acc + (list?.length || 0), 0);
  }, [symbols]);

  return (
    <div className="flex flex-col h-screen bg-[#090d16] text-slate-100 overflow-hidden font-sans">
      {/* Header */}
      <Header
        activeProject={activeProject}
        activeFile={activeFile}
        language={language}
        projects={projects}
        projectFiles={projectFiles}
        onSelectProject={setActiveProject}
        onSelectFile={setActiveFile}
        onSaveFile={handleSaveCurrentFile}
        onLoadPreset={handleLoadPreset}
        onOpenMCPModal={() => setIsMCPModalOpen(true)}
      />

      {/* Breadcrumb Navigation Bar */}
      <BreadcrumbBar
        activeProject={activeProject}
        activeFile={activeFile}
        projectPath={projects.find((p) => p.name === activeProject)?.path}
        projectFiles={projectFiles}
        language={language}
        projects={projects}
        onSelectProject={setActiveProject}
        onSelectFile={setActiveFile}
        onOpenProjectManager={() => setActiveTab('projects')}
        onToast={showToast}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          symbolsCount={totalSymbolsCount}
        />

        {/* Content Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Shared Left Pane: Code Editor (when not in standalone managers) */}
          {activeTab !== 'projects' && activeTab !== 'mcp' && (
            <div className="w-1/2 border-r border-slate-800 flex flex-col h-full overflow-hidden">
              <CodeEditor
                code={code}
                language={language}
                filename={activeFile}
                selectedNode={selectedNode}
                symbols={symbols}
                onChangeCode={setCode}
                onCopyCode={() => showToast('Código copiado!')}
              />
            </div>
          )}

          {/* Right Pane: Tool-Specific Interactive Views */}
          <div
            className={`${
              activeTab === 'projects' || activeTab === 'mcp' ? 'w-full' : 'w-1/2'
            } flex flex-col h-full overflow-hidden`}
          >
            {activeTab === 'ast' && (
              <ASTExplorerView
                ast={ast}
                selectedNode={selectedNode}
                maxDepth={maxAstDepth}
                filename={activeFile}
                activeProject={activeProject}
                language={language}
                onChangeMaxDepth={setMaxAstDepth}
                onSelectNode={(node) => setSelectedNode(node)}
                onToast={showToast}
              />
            )}

            {activeTab === 'query' && (
              <QueryStudioView
                language={language}
                queryInput={queryInput}
                queryMatches={queryMatches}
                templates={templates}
                selectedTemplate={selectedTemplate}
                loading={loading}
                errorMsg={errorMsg}
                onChangeQuery={setQueryInput}
                onSelectTemplate={handleSelectTemplate}
                onRunQuery={handleRunQuery}
              />
            )}

            {activeTab === 'symbols' && (
              <SymbolsView
                symbols={symbols}
                onJumpToLine={(line) => {
                  showToast(`Linha ${line + 1} selecionada`);
                }}
              />
            )}

            {activeTab === 'complexity' && <ComplexityView complexity={complexity} />}

            {activeTab === 'similarity' && (
              <SimilarityView
                similaritySnippet={similaritySnippet}
                similarityResults={similarityResults}
                similarityThreshold={similarityThreshold}
                loading={loading}
                onChangeSnippet={setSimilaritySnippet}
                onChangeThreshold={setSimilarityThreshold}
                onRunSimilarity={handleFindSimilar}
              />
            )}

            {activeTab === 'mcp' && (
              <MCPConsoleView
                mcpTools={mcpTools}
                selectedTool={selectedMcpTool}
                activeProject={activeProject}
                activeFile={activeFile}
                code={code}
                language={language}
                mcpOutput={mcpOutput}
                mcpLoading={mcpLoading}
                onSelectTool={setSelectedMcpTool}
                onExecuteTool={handleExecuteMCPTool}
              />
            )}

            {activeTab === 'projects' && (
              <ProjectManagerView
                projects={projects}
                activeProject={activeProject}
                projectFiles={projectFiles}
                activeFile={activeFile}
                onSelectProject={setActiveProject}
                onSelectFile={(file) => {
                  setActiveFile(file);
                  setActiveTab('ast');
                }}
                onRefreshProjects={fetchProjects}
                onNavigateToAST={() => setActiveTab('ast')}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modal: Connect Claude Desktop / Cursor */}
      <MCPConnectModal isOpen={isMCPModalOpen} onClose={() => setIsMCPModalOpen(false)} />

      {/* Toast Notification */}
      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </div>
  );
}
