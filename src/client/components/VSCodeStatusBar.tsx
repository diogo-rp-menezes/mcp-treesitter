import React from 'react';
import { GitBranch, CheckCircle2, Database, Terminal, ShieldCheck, HardDrive } from 'lucide-react';

interface VSCodeStatusBarProps {
  activeProject: string;
  activeFile: string;
  language: string;
  isDirty?: boolean;
  projectsCount?: number;
  onOpenMCPModal?: () => void;
}

export function VSCodeStatusBar({
  activeProject,
  activeFile,
  language,
  isDirty,
  projectsCount = 0,
  onOpenMCPModal,
}: VSCodeStatusBarProps) {
  return (
    <footer className="h-6 bg-[#0e7490] text-cyan-50 px-3 flex items-center justify-between text-[11px] font-sans select-none shrink-0 border-t border-[#155e75]">
      {/* Left: Git Branch, Active Project & File */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 hover:bg-cyan-800/60 px-1.5 py-0.5 rounded cursor-pointer transition">
          <GitBranch className="w-3 h-3 text-cyan-200" />
          <span className="font-mono font-medium">main*</span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 hover:bg-cyan-800/60 px-1.5 py-0.5 rounded cursor-pointer transition">
          <span className="opacity-80">Projeto:</span>
          <span className="font-mono font-semibold text-white">
            {activeProject || 'Nenhum'}
          </span>
        </div>

        {activeFile && (
          <div className="hidden md:flex items-center gap-1.5 hover:bg-cyan-800/60 px-1.5 py-0.5 rounded cursor-pointer transition">
            <span className="opacity-80">Arquivo:</span>
            <span className="font-mono text-white">{activeFile}</span>
            {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" title="Não salvo" />}
          </div>
        )}
      </div>

      {/* Center: File Encoding, Cursor position, Indent */}
      <div className="hidden lg:flex items-center gap-4 font-mono text-[10px] opacity-90">
        <span>Ln 1, Col 1</span>
        <span>Espaços: 4</span>
        <span>UTF-8</span>
        <span>LF</span>
        <span className="uppercase font-semibold text-white bg-cyan-900/60 px-1.5 py-0.2 rounded border border-cyan-700/50">
          {language}
        </span>
      </div>

      {/* Right: Server Engine Status & MCP Status */}
      <div className="flex items-center gap-3">
        <div className="hidden xl:flex items-center gap-1 text-[10px] font-mono opacity-90">
          <ShieldCheck className="w-3 h-3 text-emerald-300" />
          <span>Isolamento Hermético</span>
        </div>

        <div className="flex items-center gap-1 hover:bg-cyan-800/60 px-1.5 py-0.5 rounded cursor-pointer transition" onClick={onOpenMCPModal}>
          <Database className="w-3 h-3 text-cyan-200" />
          <span className="font-mono text-[10px]">SQLite WAL</span>
        </div>

        <div
          onClick={onOpenMCPModal}
          className="flex items-center gap-1.5 hover:bg-cyan-800/60 px-1.5 py-0.5 rounded cursor-pointer transition font-mono font-semibold"
          title="Servidor MCP Online"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
          <span>MCP Online</span>
        </div>
      </div>
    </footer>
  );
}
