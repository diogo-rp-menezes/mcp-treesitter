import { detectLanguage } from './parser';

export interface GitHubRepoDetails {
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string;
  stars: number;
}

export interface ImportedGitHubFile {
  path: string;
  content: string;
  language: string;
  size: number;
}

export interface GitHubImportResult {
  repo: GitHubRepoDetails;
  branch: string;
  files: ImportedGitHubFile[];
  totalDiscovered: number;
  detectedLanguages: string[];
}

const ALLOWED_EXTS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
  '.json', '.yaml', '.yml', '.toml', '.md', '.sql', '.html', '.css'
]);

const IGNORED_PATHS = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  '.next/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.turbo/',
  '.cache/',
  'coverage/',
  '.github/',
];

/**
 * Parses various GitHub URL formats or "owner/repo" shorthand.
 */
export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // Pattern for git@github.com:owner/repo(.git)
  const sshMatch = trimmed.match(/^git@github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // Pattern for https?://(www.)?github.com/owner/repo
  const urlMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git|\/.*)?$/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // Pattern for "owner/repo" shorthand
  const shortMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  return null;
}

/**
 * Fetches repository metadata from GitHub REST API.
 */
export async function fetchGitHubRepoDetails(
  owner: string,
  repo: string,
  token?: string
): Promise<GitHubRepoDetails> {
  const headers: Record<string, string> = {
    'User-Agent': 'AIStudio-TreeSitter-MCP',
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) {
    headers['Authorization'] = `token ${token.trim()}`;
  }

  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers,
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Repositório '${owner}/${repo}' não encontrado no GitHub. Verifique a URL ou forneça um token caso seja privado.`);
    }
    if (res.status === 403) {
      const rateLimitMsg = res.headers.get('x-ratelimit-remaining') === '0'
        ? 'Limite de requisições anônimas da API do GitHub excedido. Forneça um Personal Access Token para continuar.'
        : 'Acesso negado pela API do GitHub.';
      throw new Error(rateLimitMsg);
    }
    throw new Error(`Erro ao consultar GitHub API: HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    owner: data.owner?.login || owner,
    repo: data.name || repo,
    defaultBranch: data.default_branch || 'main',
    description: data.description || '',
    stars: data.stargazers_count || 0,
  };
}

/**
 * Fetches and filters source code files from GitHub repository.
 */
export async function importGitHubRepository(options: {
  repoUrl: string;
  branch?: string;
  subpath?: string;
  token?: string;
  maxFiles?: number;
}): Promise<GitHubImportResult> {
  const parsed = parseGitHubRepo(options.repoUrl);
  if (!parsed) {
    throw new Error('URL ou formato de repositório inválido. Utilize "owner/repo" ou "https://github.com/owner/repo".');
  }

  const details = await fetchGitHubRepoDetails(parsed.owner, parsed.repo, options.token);
  const targetBranch = options.branch?.trim() || details.defaultBranch;
  const maxFiles = Math.min(Math.max(1, options.maxFiles || 60), 120);

  const headers: Record<string, string> = {
    'User-Agent': 'AIStudio-TreeSitter-MCP',
    Accept: 'application/vnd.github.v3+json',
  };
  if (options.token) {
    headers['Authorization'] = `token ${options.token.trim()}`;
  }

  // Fetch full recursive file tree from GitHub Git Trees API
  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(targetBranch)}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers });

  if (!treeRes.ok) {
    throw new Error(`Não foi possível obter a árvore de arquivos para a branch '${targetBranch}'. Verifique se o branch existe.`);
  }

  const treeData = await treeRes.json();
  const tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }> = treeData.tree || [];

  const subpathFilter = options.subpath?.trim().replace(/^\/+|\/+$/g, '') || '';

  // Filter to valid code files
  const candidateFiles = tree.filter((item) => {
    if (item.type !== 'blob') return false;
    if (subpathFilter && !item.path.startsWith(`${subpathFilter}/`) && item.path !== subpathFilter) {
      return false;
    }
    // Check ignored folders
    if (IGNORED_PATHS.some((ign) => item.path.includes(ign))) {
      return false;
    }
    // Exclude large binary/asset files (> 500KB)
    if (item.size && item.size > 500 * 1024) {
      return false;
    }
    const extMatch = item.path.match(/\.[a-zA-Z0-9]+$/);
    if (!extMatch) return false;
    return ALLOWED_EXTS.has(extMatch[0].toLowerCase());
  });

  const selectedFiles = candidateFiles.slice(0, maxFiles);
  const detectedLanguages = new Set<string>();

  // Concurrently fetch content in batches of 10
  const importedFiles: ImportedGitHubFile[] = [];
  const batchSize = 10;

  for (let i = 0; i < selectedFiles.length; i += batchSize) {
    const batch = selectedFiles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/${encodeURIComponent(targetBranch)}/${item.path}`;
          const rawRes = await fetch(rawUrl, {
            headers: options.token ? { Authorization: `token ${options.token.trim()}` } : {},
          });

          if (!rawRes.ok) return null;
          const content = await rawRes.text();

          // Calculate normalized relative path if subpath was specified
          const relativePath = subpathFilter && item.path.startsWith(`${subpathFilter}/`)
            ? item.path.slice(subpathFilter.length + 1)
            : item.path;

          const lang = detectLanguage(relativePath);
          detectedLanguages.add(lang);

          return {
            path: relativePath,
            content,
            language: lang,
            size: content.length,
          };
        } catch {
          return null;
        }
      })
    );

    for (const res of results) {
      if (res && res.content.length > 0) {
        importedFiles.push(res);
      }
    }
  }

  if (importedFiles.length === 0) {
    throw new Error('Nenhum arquivo de código suportado foi encontrado no repositório com os filtros informados.');
  }

  return {
    repo: details,
    branch: targetBranch,
    files: importedFiles,
    totalDiscovered: candidateFiles.length,
    detectedLanguages: Array.from(detectedLanguages),
  };
}
