import React, { useState } from 'react';
import { FolderTree, Plus, FileCode, Trash2, ArrowRight, Layers, FilePlus } from 'lucide-react';
import { ProjectInfo } from '../types';

interface ProjectManagerViewProps {
  projects: ProjectInfo[];
  activeProject: string;
  projectFiles: string[];
  activeFile: string;
  onSelectProject: (name: string) => void;
  onSelectFile: (file: string) => void;
  onRefreshProjects: () => void;
}

export function ProjectManagerView({
  projects,
  activeProject,
  projectFiles,
  activeFile,
  onSelectProject,
  onSelectFile,
  onRefreshProjects,
}: ProjectManagerViewProps) {
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showNewFileModal, setShowNewFileModal] = useState(false);

  const handleCreateProject = async () => {
    if (!newProjName.trim()) return;
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjName.trim(), description: newProjDesc.trim() }),
      });
      setNewProjName('');
      setNewProjDesc('');
      setShowNewProjectModal(false);
      onRefreshProjects();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    try {
      await fetch(`/api/projects/${encodeURIComponent(activeProject)}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: newFileName.trim(),
          content: `# ${newFileName.trim()}\n\ndef main():\n    pass\n`,
        }),
      });
      setNewFileName('');
      setShowNewFileModal(false);
      onRefreshProjects();
      onSelectFile(newFileName.trim());
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0f172a] overflow-auto p-6 space-y-6">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-cyan-400" />
              Projetos & Workspace de Código
            </h3>
            <p className="text-xs text-slate-400">
              Gerencie os repositórios e arquivos analisados pelas ferramentas Tree-sitter do MCP.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Projeto</span>
            </button>
          </div>
        </div>

        {/* Modal: New Project */}
        {showNewProjectModal && (
          <div className="bg-slate-900 border border-slate-700 p-4 rounded-xl space-y-3 max-w-md shadow-2xl">
            <h4 className="font-semibold text-xs text-slate-200">Criar Novo Projeto</h4>
            <input
              type="text"
              placeholder="Nome do projeto (ex: backend-api)"
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <input
              type="text"
              placeholder="Descrição opcional"
              value={newProjDesc}
              onChange={(e) => setNewProjDesc(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowNewProjectModal(false)}
                className="px-3 py-1 bg-slate-800 text-slate-300 rounded text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateProject}
                className="px-3 py-1 bg-cyan-600 text-white rounded text-xs font-medium"
              >
                Salvar
              </button>
            </div>
          </div>
        )}

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((proj) => {
            const isActive = activeProject === proj.name;
            return (
              <div
                key={proj.name}
                onClick={() => onSelectProject(proj.name)}
                className={`p-4 rounded-xl border transition cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 border-cyan-500/60 shadow-lg shadow-cyan-950/20'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="font-semibold text-sm text-slate-200 flex items-center gap-2">
                      <FolderTree className="w-4 h-4 text-cyan-400" />
                      {proj.name}
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">{proj.description}</p>
                  </div>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    {proj.fileCount} arquivos
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="font-mono text-[11px] text-slate-500">{proj.path}</span>
                  {isActive ? (
                    <span className="text-cyan-400 font-medium text-xs flex items-center gap-1">
                      Projeto Ativo
                    </span>
                  ) : (
                    <span className="text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1">
                      Selecionar <ArrowRight className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Files in Active Project */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-sm text-slate-200">
                Arquivos do Projeto: <span className="text-cyan-400 font-mono">{activeProject}</span>
              </h4>
              <p className="text-[11px] text-slate-400">
                Selecione qualquer arquivo para inspecionar sua AST, símbolos e queries.
              </p>
            </div>

            <button
              onClick={() => setShowNewFileModal(true)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 text-xs flex items-center gap-1.5 transition"
            >
              <FilePlus className="w-3.5 h-3.5 text-cyan-400" />
              <span>Adicionar Arquivo</span>
            </button>
          </div>

          {/* Modal: New File */}
          {showNewFileModal && (
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2 max-w-sm">
              <label className="block text-[11px] text-slate-300">Caminho / Nome do arquivo:</label>
              <input
                type="text"
                placeholder="Ex: parser.py, types.ts, main.go"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowNewFileModal(false)}
                  className="px-3 py-1 bg-slate-800 text-slate-300 rounded text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateFile}
                  className="px-3 py-1 bg-cyan-600 text-white rounded text-xs font-medium"
                >
                  Criar
                </button>
              </div>
            </div>
          )}

          {/* Files grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {projectFiles.map((file) => {
              const isSelected = activeFile === file;
              return (
                <div
                  key={file}
                  onClick={() => onSelectFile(file)}
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between cursor-pointer transition ${
                    isSelected
                      ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-200 shadow-sm'
                      : 'bg-slate-950 border-slate-850 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="font-mono truncate">{file}</span>
                  </div>
                  {isSelected && (
                    <span className="text-[10px] text-cyan-400 font-medium">Em Edição</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
