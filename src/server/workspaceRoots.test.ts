/**
 * Standalone verification suite for workspace root boundary validation
 * (audit finding SEC-03). No test-framework dependency — run with:
 *
 *   npx tsx src/server/workspaceRoots.test.ts
 *
 * Exits with code 1 if any assertion fails. A proper Vitest suite is the
 * scope of audit finding TEST-01; this script covers SEC-03 without
 * adding dependencies.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isPathWithinRoots,
  parseWorkspaceRootsConfig,
  validateScanDirectoryPath,
  type WorkspaceRootsConfig,
} from './workspaceRoots';

const IS_WIN = process.platform === 'win32';

let passed = 0;
let failed = 0;

function run(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${(err as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} (actual=${a}, expected=${e})`);
}

function assertThrows(fn: () => void, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

// ---- parseWorkspaceRootsConfig --------------------------------------------

console.log('parseWorkspaceRootsConfig:');
run('default "/workspace" quando a variavel esta ausente', () => {
  const config = parseWorkspaceRootsConfig({});
  assertEqual(config.roots, [path.resolve('/workspace')], 'default roots');
});

run('default "/workspace" quando a variavel esta vazia', () => {
  const config = parseWorkspaceRootsConfig({ MCP_ALLOWED_WORKSPACE_ROOTS: '' });
  assertEqual(config.roots, [path.resolve('/workspace')], 'default roots');
});

run('lista separada por virgula com espacos e trim', () => {
  const config = parseWorkspaceRootsConfig({ MCP_ALLOWED_WORKSPACE_ROOTS: ' /a , /b ' });
  assertEqual(config.roots, [path.resolve('/a'), path.resolve('/b')], 'roots parseados');
});

run('root relativa (./src) resolve contra o cwd', () => {
  const config = parseWorkspaceRootsConfig({ MCP_ALLOWED_WORKSPACE_ROOTS: './src' });
  assertEqual(config.roots, [path.resolve('./src')], 'root relativa');
});

run('duplicatas sao deduplicadas', () => {
  const config = parseWorkspaceRootsConfig({ MCP_ALLOWED_WORKSPACE_ROOTS: '/a,/a' });
  assertEqual(config.roots, [path.resolve('/a')], 'sem duplicatas');
});

run('lista vazia apos filtro aborta (fail-fast)', () => {
  assertThrows(
    () => parseWorkspaceRootsConfig({ MCP_ALLOWED_WORKSPACE_ROOTS: ' , ' }),
    'deveria lancar para lista vazia'
  );
});

run('null byte em root aborta (fail-fast)', () => {
  assertThrows(
    () => parseWorkspaceRootsConfig({ MCP_ALLOWED_WORKSPACE_ROOTS: '/a\0b' }),
    'deveria lancar para null byte'
  );
});

// ---- isPathWithinRoots (lexico) -------------------------------------------

console.log('isPathWithinRoots:');
const lexicalRoot = path.resolve('/workspace');

run('candidato igual a propria root e permitido', () => {
  assert(isPathWithinRoots(lexicalRoot, [lexicalRoot]), 'igualdade deve permitir');
});

run('caminho dentro da root e permitido', () => {
  assert(isPathWithinRoots(path.join(lexicalRoot, 'proj'), [lexicalRoot]), 'dentro deve permitir');
});

run('irmao com mesmo prefixo e rejeitado', () => {
  assert(!isPathWithinRoots(`${lexicalRoot}-evil`, [lexicalRoot]), 'prefixo nao e boundary');
});

run('caminho fora das roots e rejeitado', () => {
  assert(!isPathWithinRoots(path.resolve('/etc'), [lexicalRoot]), 'fora deve rejeitar');
});

run('traversal com .. escapa e e rejeitado', () => {
  assert(!isPathWithinRoots(path.join(lexicalRoot, '..', 'x'), [lexicalRoot]), '.. deve escapar');
});

run('separadores mistos sao normalizados', () => {
  const candidate = path.join(lexicalRoot, 'proj').replace(/\\/g, '/');
  assert(isPathWithinRoots(candidate, [lexicalRoot]), 'normalizacao de separadores');
});

if (IS_WIN) {
  run('win32: comparacao case-insensitive', () => {
    assert(
      isPathWithinRoots(lexicalRoot.toUpperCase(), [lexicalRoot.toLowerCase()]),
      'case-insensitive no win32'
    );
  });
}

// ---- validateScanDirectoryPath (com filesystem real) -----------------------

console.log('validateScanDirectoryPath:');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpts-roots-'));
const config: WorkspaceRootsConfig = { roots: [root] };

try {
  fs.mkdirSync(path.join(root, 'proj'));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'not a directory');

  run('caminho absoluto valido dentro da root', () => {
    const result = validateScanDirectoryPath(path.join(root, 'proj'), config);
    assert(result.ok, 'deveria ser ok');
    if (result.ok) {
      assertEqual(result.resolvedPath, path.resolve(path.join(root, 'proj')), 'resolvedPath');
    }
  });

  run('a propria root e valida', () => {
    const result = validateScanDirectoryPath(root, config);
    assert(result.ok, 'root em si deveria ser valida');
  });

  run('absoluto fora das roots retorna 403 sem vazar a root', () => {
    const result = validateScanDirectoryPath(os.tmpdir(), config);
    assert(!result.ok && result.status === 403, 'esperado 403');
    assert(!result.ok && !result.error.includes(root), 'mensagem 403 nao deve vazar a root');
  });

  run('.. escapando da root retorna 403', () => {
    const result = validateScanDirectoryPath(path.join(root, '..', 'elsewhere'), config);
    assert(!result.ok && result.status === 403, 'esperado 403');
  });

  run('inexistente dentro da root retorna 404 (ecoando apenas o path do cliente)', () => {
    const result = validateScanDirectoryPath(path.join(root, 'missing'), config);
    assert(!result.ok && result.status === 404, 'esperado 404');
  });

  run('arquivo (nao diretorio) retorna 400', () => {
    const result = validateScanDirectoryPath(path.join(root, 'notes.txt'), config);
    assert(!result.ok && result.status === 400, 'esperado 400');
  });

  run('null byte retorna 400', () => {
    const result = validateScanDirectoryPath('dir\0name', config);
    assert(!result.ok && result.status === 400, 'esperado 400');
  });

  run('ausente / vazio / tipo errado retornam 400', () => {
    for (const bad of [undefined, '', 123, {}, null]) {
      const result = validateScanDirectoryPath(bad, config);
      assert(!result.ok && result.status === 400, `esperado 400 para ${JSON.stringify(bad)}`);
    }
  });

  run('relativo valido contra cwd + relativo .. retorna 403', () => {
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      const okResult = validateScanDirectoryPath('proj', config);
      assert(okResult.ok, 'relativo dentro da root deveria passar');
      const escape = validateScanDirectoryPath('..', config);
      assert(!escape.ok && escape.status === 403, 'relativo .. deveria dar 403');
    } finally {
      process.chdir(previousCwd);
    }
  });

  if (IS_WIN) {
    run('win32: casing diferente do disco ainda e valido', () => {
      const result = validateScanDirectoryPath(path.join(root, 'PROJ'), config);
      assert(result.ok, 'case-insensitive deveria permitir');
    });
  }

  // Symlink escape — pulado se o ambiente nao permitir criacao de symlink
  // (ex.: Windows sem modo desenvolvedor / privilegio de administrador).
  let symlinkAvailable = true;
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpts-outside-'));
  try {
    fs.symlinkSync(outside, path.join(root, 'escape-link'), 'dir');
  } catch {
    symlinkAvailable = false;
  }

  if (symlinkAvailable) {
    run('symlink dentro da root apontando para fora retorna 403', () => {
      const result = validateScanDirectoryPath(path.join(root, 'escape-link'), config);
      assert(!result.ok && result.status === 403, 'esperado 403 para symlink escape');
    });
    run('mensagem 403 de symlink nao vaza caminhos internos', () => {
      const result = validateScanDirectoryPath(path.join(root, 'escape-link'), config);
      assert(
        !result.ok && !result.error.includes(outside) && !result.error.includes(root),
        'sem vazamento de caminhos'
      );
    });
  } else {
    console.log('  SKIP  testes de symlink (criacao nao permitida neste ambiente)');
  }
  fs.rmSync(outside, { recursive: true, force: true });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
