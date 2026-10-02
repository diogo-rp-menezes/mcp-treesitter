import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  RefreshCw,
  FolderGit2,
  ExternalLink,
  Copy,
  Check,
  Plus,
} from 'lucide-react';
import { GitRepoStatus } from '../types';

interface GitStatusPanelProps {
  activeProject: string;
  projectPath?: string;
}

export function GitStatusPanel({ activeProject, projectPath }: GitStatusPanelProps) {
  const [gitStatus, setGitStatus] = useState<GitRepoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  const fetchGitStatus = async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/git-status`);
      if (res.ok) {
        const data = await res.json();
        setGitStatus(data);
      }
    } catch (err) {
      console.error('Failed to load git status', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGitStatus();
  }, [activeProject]);

  const handleInitGit = async () => {
    setInitLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/git-init`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setGitStatus(data);
      }
    } catch (err) {
      console.error('Failed to init git', err);
    } finally {
      setInitLoading(false);
    }
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  if (!gitStatus && !loading) return null;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <FolderGit2 className="w-5 h-5 text-cyan-400" />
          <div>
            <h4 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
              Status do Git: <span className="text-cyan-400 font-mono">{activeProject}</span>
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Controle de versão e histórico do workspace ativo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={fetchGitStatus}
            disabled={loading}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition"
            title="Atualizar status do Git"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {gitStatus?.isGitRepo ? (
        <div className="space-y-3.5 text-xs animate-in fade-in duration-150">
          {/* Key Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Branch Card */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-950/60 border border-cyan-800/80 flex items-center justify-center text-cyan-400 shrink-0">
                <GitBranch className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Branch Atual</div>
                <div className="font-mono font-bold text-slate-100 text-sm truncate flex items-center gap-1.5 mt-0.5">
                  <span className="text-cyan-300">{gitStatus.branch}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Branch ativo" />
                </div>
              </div>
            </div>

            {/* Uncommitted Changes Card */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850 flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                  gitStatus.uncommittedCount === 0
                    ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-400'
                    : 'bg-amber-950/60 border-amber-800/80 text-amber-400'
                }`}
              >
                {gitStatus.uncommittedCount === 0 ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Alterações Pendentes</div>
                <div className="font-mono font-bold text-slate-100 text-sm tabular-nums mt-0.5">
                  {gitStatus.uncommittedCount === 0 ? (
                    <span className="text-emerald-400 font-sans text-xs">Working tree limpa</span>
                  ) : (
                    <span className="text-amber-400">
                      {gitStatus.uncommittedCount} arquivo(s)
                    </span>
                  )}
                </div>
                {gitStatus.uncommittedCount > 0 && (
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {gitStatus.stagedCount} staged · {gitStatus.modifiedCount} mod · {gitStatus.untrackedCount} untracked
                  </div>
                )}
              </div>
            </div>

            {/* Last Commit Hash Card */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-950/60 border border-purple-800/80 flex items-center justify-center text-purple-400 shrink-0">
                <GitCommit className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Último Commit</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono font-bold text-purple-300 text-xs bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-800/50">
                    {gitStatus.lastCommit?.hash || 'HEAD'}
                  </span>
                  {gitStatus.lastCommit?.hash && (
                    <button
                      onClick={() => handleCopyHash(gitStatus.lastCommit!.hash)}
                      className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition"
                      title="Copiar Hash"
                    >
                      {copiedHash ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Last Commit Detail Box */}
          {gitStatus.lastCommit && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-900 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-300">Mensagem do Commit:</span>
                  <span className="text-slate-100 font-mono text-xs">{gitStatus.lastCommit.message}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[10px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3 text-slate-400" />
                    {gitStatus.lastCommit.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {gitStatus.lastCommit.relativeDate}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-0.5">
                <span>Repositório: {gitStatus.repoPath}</span>
                {gitStatus.remoteUrl && (
                  <span className="text-cyan-400 truncate max-w-sm">
                    Remoto: {gitStatus.remoteUrl}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Not a Git Repository State */
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-850 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="space-y-1">
            <div className="font-semibold text-slate-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span>Nenhum Repositório Git Ativo Detectado</span>
            </div>
            <p className="text-slate-500 text-[11px]">
              O diretório configurado (<code className="text-cyan-400 font-mono">{projectPath || activeProject}</code>) ainda não foi inicializado com controle de versão Git.
            </p>
          </div>

          <button
            onClick={handleInitGit}
            disabled={initLoading}
            className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold flex items-center gap-1.5 transition text-xs shrink-0 self-start sm:self-auto"
          >
            {initLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Inicializando...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Inicializar Git (git init)</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
