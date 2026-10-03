import { currentBranch, init, listRemotes, log, statusMatrix } from 'isomorphic-git';
import fs from 'fs';
import path from 'path';

export interface GitCommitInfo {
  hash: string;
  author: string;
  relativeDate: string;
  date: string;
  message: string;
}

export interface GitRepoStatus {
  isGitRepo: boolean;
  branch: string | null;
  uncommittedCount: number;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  lastCommit: GitCommitInfo | null;
  remoteUrl: string | null;
  statusText: string;
  repoPath: string;
}

/**
 * Identity written to the repository's local config right after
 * `initProjectGitRepo()`, so commits work without a global git identity.
 */
const GIT_IDENTITY = {
  name: 'AI Studio',
  email: 'dev@aistudio.local',
} as const;

/**
 * Conservative allowlist for branch names accepted by `initProjectGitRepo()`.
 * Mirrors the safe subset of `git check-ref-format` rules: no shell
 * metacharacters, no `..`, no `@{`, no leading/trailing separators.
 * `isomorphic-git` never passes this value to a shell, but validating it
 * keeps repository refs sane (defense in depth).
 */
const SAFE_BRANCH_PATTERN = /^[A-Za-z0-9._-][A-Za-z0-9._/-]*$/;

interface WorktreeLocation {
  /** Working tree root (the directory that contains or links the `.git` entry). */
  dir: string;
  /** Absolute path of the `.git` directory (differs from `dir/.git` for linked worktrees). */
  gitdir: string;
}

function emptyGitStatus(statusText: string, repoPath: string): GitRepoStatus {
  return {
    isGitRepo: false,
    branch: null,
    uncommittedCount: 0,
    stagedCount: 0,
    modifiedCount: 0,
    untrackedCount: 0,
    lastCommit: null,
    remoteUrl: null,
    statusText,
    repoPath,
  };
}

/**
 * Finds the git worktree that contains `startDir`, walking up the directory
 * chain the same way `git rev-parse --is-inside-work-tree` does, so queries
 * from subdirectories still report the containing repository.
 * Supports linked worktrees, where `.git` is a file pointing at the real gitdir.
 */
function discoverWorktree(startDir: string): WorktreeLocation | null {
  let current = path.resolve(startDir);
  for (;;) {
    const dotGitPath = path.join(current, '.git');
    if (fs.existsSync(dotGitPath)) {
      const stat = fs.statSync(dotGitPath);
      if (stat.isDirectory()) {
        return { dir: current, gitdir: dotGitPath };
      }
      if (stat.isFile()) {
        const content = fs.readFileSync(dotGitPath, 'utf-8');
        const match = /^gitdir:\s*(.+)$/m.exec(content);
        const linkedGitdir = match ? path.resolve(current, match[1].trim()) : null;
        if (linkedGitdir && fs.existsSync(linkedGitdir)) {
          return { dir: current, gitdir: linkedGitdir };
        }
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Formats an epoch-seconds timestamp as a short pt-BR relative date. */
function formatRelativeDate(timestampSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestampSeconds));
  if (seconds < 60) return 'agora mesmo';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} minuto${minutes > 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} hora${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} dia${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months > 1 ? 'meses' : 'mês'}`;
  const years = Math.floor(days / 365);
  return `há ${years} ano${years > 1 ? 's' : ''}`;
}

interface WorktreeCounts {
  uncommittedCount: number;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
}

/**
 * Counts pending changes from `git.statusMatrix()`.
 *
 * Each matrix row is `[filepath, headStatus, workdirStatus, stageStatus]`.
 * Status values are indices of the first occurrence of each tree's blob OID
 * in the row's deduplicated OID list, so equal values always mean equal
 * content: `[1,1,1]` is unchanged, `[1,2,1]` a workdir-only modification,
 * `[0,2,0]` untracked, `[1,0,1]` a workdir-only deletion, and `0` means the
 * file is absent from that tree.
 *
 * Mapping parity with `git status --porcelain`:
 * - untracked -> `??` rows (absent from HEAD and index, present in workdir)
 * - staged   -> index differs from HEAD (`A `, `M `, `D `, ...)
 * - modified -> workdir differs from index (` M`, ` D`, `MM`, ...)
 *
 * Known divergences (display-only counters):
 * - renames/copies count as separate rows (no rename detection);
 * - untracked directories count per file, not per directory;
 * - same-size rewrites within the same mtime second as the last index
 *   refresh are reported as unchanged: isomorphic-git trusts index stats
 *   and does not implement git's "racily clean" re-hash, so such a change
 *   is missed until the file's stats drift again.
 */
async function countWorktreeChanges(location: WorktreeLocation): Promise<WorktreeCounts> {
  let stagedCount = 0;
  let modifiedCount = 0;
  let untrackedCount = 0;
  let uncommittedCount = 0;

  try {
    const matrix = await statusMatrix({
      fs,
      dir: location.dir,
      gitdir: location.gitdir,
    });

    for (const [, head, workdir, stage] of matrix) {
      // A row of [1, 1, 1] means HEAD, index and workdir all agree:
      // the file is unchanged and must not count as a pending change.
      if (head === 1 && workdir === 1 && stage === 1) continue;

      uncommittedCount++;

      if (head === 0 && stage === 0 && workdir !== 0) {
        untrackedCount++;
        continue;
      }

      const indexPresenceChanged = (head === 0) !== (stage === 0);
      const indexContentChanged = head !== 0 && stage !== 0 && head !== stage;
      if (indexPresenceChanged || indexContentChanged) stagedCount++;

      const workdirPresenceChanged = (workdir === 0) !== (stage === 0);
      const workdirContentChanged = workdir !== 0 && stage !== 0 && workdir !== stage;
      if (workdirPresenceChanged || workdirContentChanged) modifiedCount++;
    }
  } catch {
    // Status unavailable (e.g. unreadable index) — report zero counts.
  }

  return { uncommittedCount, stagedCount, modifiedCount, untrackedCount };
}

/**
 * Checks the Git status of a project path safely.
 *
 * All git access goes through `isomorphic-git` (pure TypeScript, no child
 * processes), so `projectPath` can never be interpreted as a shell command.
 * The function never throws: failures are reported through the returned
 * `GitRepoStatus` so HTTP callers always get structured feedback.
 */
export async function getProjectGitStatus(projectPath: string): Promise<GitRepoStatus> {
  const normalizedPath = path.resolve(projectPath);

  // Defense in depth: reject null bytes before touching the filesystem
  // (mirrors the guard used by isolation.ts for user-supplied paths).
  if (projectPath.includes('\0')) {
    return emptyGitStatus('Caminho inválido (contém bytes nulos)', projectPath);
  }

  // If the path doesn't exist on disk, check if it's within the main workspace root
  let targetPath = normalizedPath;
  if (!fs.existsSync(targetPath)) {
    // If the project path is virtual like /projects/tree-sitter-core, fallback to workspace root
    if (fs.existsSync('/workspace')) {
      targetPath = '/workspace';
    } else {
      return emptyGitStatus(`Diretório '${projectPath}' não encontrado no disco local`, projectPath);
    }
  }

  try {
    const location = discoverWorktree(targetPath);
    if (!location) {
      return emptyGitStatus('Não é um repositório Git', targetPath);
    }

    // Branch name (symbolic HEAD; falls back to 'HEAD' when detached or unreadable)
    let branch = 'HEAD';
    try {
      branch = (await currentBranch({ fs, dir: location.dir, gitdir: location.gitdir })) ?? 'HEAD';
    } catch {
      branch = 'HEAD';
    }

    const counts = await countWorktreeChanges(location);

    // Last commit details (absent in repositories without commits)
    let lastCommit: GitCommitInfo | null = null;
    try {
      const [entry] = await log({ fs, dir: location.dir, gitdir: location.gitdir, depth: 1 });
      if (entry) {
        const author = entry.commit.author;
        const timestamp = author?.timestamp ?? Math.floor(Date.now() / 1000);
        const subject = entry.commit.message.split('\n')[0].trim();
        lastCommit = {
          hash: entry.oid.slice(0, 7) || '0000000',
          author: author?.name || 'Autor',
          relativeDate: formatRelativeDate(timestamp),
          message: subject || 'Nenhum commit',
          date: new Date(timestamp * 1000).toISOString(),
        };
      }
    } catch {
      // Empty repository without commits
    }

    // Remote URL (origin)
    let remoteUrl: string | null = null;
    try {
      const remotes = await listRemotes({ fs, dir: location.dir, gitdir: location.gitdir });
      remoteUrl = remotes.find((remote) => remote.remote === 'origin')?.url ?? null;
    } catch {
      remoteUrl = null;
    }

    const statusText =
      counts.uncommittedCount === 0
        ? 'Working tree limpa (nenhuma alteração pendente)'
        : `${counts.uncommittedCount} arquivo(s) com alterações pendentes (${counts.stagedCount} staged, ${counts.modifiedCount} modificados, ${counts.untrackedCount} untracked)`;

    return {
      isGitRepo: true,
      branch,
      ...counts,
      lastCommit,
      remoteUrl,
      statusText,
      repoPath: targetPath,
    };
  } catch (err) {
    console.error(
      `[git] Failed to inspect repository at '${targetPath}':`,
      err instanceof Error ? err.message : err
    );
    return emptyGitStatus('Git não configurado ou pasta inacessível', targetPath);
  }
}

/**
 * Ensures the repository's local config has a `[user]` identity so commits
 * work without a global git identity. `isomorphic-git` has no config-write
 * API, so this writes the INI section directly; the values are compile-time
 * constants and never derived from user input. Idempotent: repeated calls
 * never append duplicate sections.
 */
async function writeLocalUserIdentity(repoDir: string): Promise<void> {
  const configPath = path.join(repoDir, '.git', 'config');
  let existing = '';
  try {
    existing = await fs.promises.readFile(configPath, 'utf-8');
  } catch {
    // Fresh repository without a config yet — treat as empty.
  }
  if (
    existing.includes(`name = ${GIT_IDENTITY.name}`) &&
    existing.includes(`email = ${GIT_IDENTITY.email}`)
  ) {
    return;
  }
  const section = `\n[user]\n\tname = ${GIT_IDENTITY.name}\n\temail = ${GIT_IDENTITY.email}\n`;
  await fs.promises.appendFile(configPath, section, 'utf-8');
}

/**
 * Initializes a new Git repository at projectPath.
 *
 * Uses `isomorphic-git` (no child processes), so neither `projectPath` nor
 * `branchName` ever reaches a shell. Like `getProjectGitStatus()`, this never
 * throws: failures are reported through the returned `GitRepoStatus`.
 */
export async function initProjectGitRepo(projectPath: string, branchName = 'main'): Promise<GitRepoStatus> {
  const normalizedPath = path.resolve(projectPath);

  if (projectPath.includes('\0')) {
    return emptyGitStatus('Caminho inválido (contém bytes nulos)', projectPath);
  }

  if (
    !SAFE_BRANCH_PATTERN.test(branchName) ||
    branchName.includes('..') ||
    branchName.includes('@{') ||
    branchName.endsWith('/') ||
    branchName.endsWith('.')
  ) {
    return emptyGitStatus(`Nome de branch inválido: '${branchName}'`, normalizedPath);
  }

  try {
    await fs.promises.mkdir(normalizedPath, { recursive: true });
    await init({ fs, dir: normalizedPath, defaultBranch: branchName });
    await writeLocalUserIdentity(normalizedPath);
    return await getProjectGitStatus(normalizedPath);
  } catch (err) {
    console.error(
      `[git] Failed to initialize repository at '${normalizedPath}':`,
      err instanceof Error ? err.message : err
    );
    return emptyGitStatus('Falha ao inicializar repositório Git', normalizedPath);
  }
}
