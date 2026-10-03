/**
 * Standalone verification suite for CORS origin allowlist configuration
 * (audit finding SEC-04). No test-framework dependency — run with:
 *
 *   npx tsx src/server/corsConfig.test.ts
 *
 * Exits with code 1 if any assertion fails. A proper Vitest suite is the
 * scope of audit finding TEST-01; this script covers SEC-04 without adding
 * dependencies.
 */

import { createCorsOptions, parseCorsConfig } from './corsConfig';

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

// ---- parseCorsConfig --------------------------------------------------------

console.log('parseCorsConfig:');

run('default http://localhost:3000 quando a variavel esta ausente', () => {
  const config = parseCorsConfig({});
  assertEqual(config, { origins: ['http://localhost:3000'], wildcard: false }, 'default');
});

run('default http://localhost:3000 quando a variavel esta vazia', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: '' });
  assertEqual(config, { origins: ['http://localhost:3000'], wildcard: false }, 'default');
});

run('lista separada por virgula com espacos e trim', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: ' https://a.com , https://b.com ' });
  assertEqual(config.origins, ['https://a.com', 'https://b.com'], 'origins parseadas');
});

run('barra final e removida pela canonicalizacao', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: 'https://a.com/' });
  assertEqual(config.origins, ['https://a.com'], 'sem barra final');
});

run('host maiusculo e normalizado para minusculo', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: 'https://App.Example.COM' });
  assertEqual(config.origins, ['https://app.example.com'], 'host minusculo');
});

run('porta default (443) e omitida na canonicalizacao', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: 'https://a.com:443' });
  assertEqual(config.origins, ['https://a.com'], 'porta default omitida');
});

run('porta nao-default e preservada', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: 'http://localhost:5173' });
  assertEqual(config.origins, ['http://localhost:5173'], 'porta preservada');
});

run('duplicatas (incluindo com barra final) sao deduplicadas', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: 'https://a.com,https://a.com/' });
  assertEqual(config.origins, ['https://a.com'], 'deduplicadas');
});

run('origem relativa sem protocolo aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: 'example.com' }), 'deveria abortar');
});

run('protocolo nao http(s) aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: 'ftp://example.com' }), 'deveria abortar');
});

run('origem com path aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: 'https://a.com/app' }), 'deveria abortar');
});

run('origem com query aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: 'https://a.com?x=1' }), 'deveria abortar');
});

run('origem com fragment aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: 'https://a.com#top' }), 'deveria abortar');
});

run('origem com userinfo aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: 'https://user:pw@a.com' }), 'deveria abortar');
});

run('null byte aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: 'https://a.com\0' }), 'deveria abortar');
});

run('lista apenas com virgulas aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: ' , , ' }), 'deveria abortar');
});

run('"*" sem opt-in aborta (fail-closed)', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ORIGINS: '*' }), 'deveria abortar');
  assertThrows(
    () => parseCorsConfig({ MCP_CORS_ORIGINS: '*', MCP_CORS_ALLOW_WILDCARD: 'false' }),
    'deveria abortar'
  );
});

run('"*" com opt-in explicito ativa wildcard', () => {
  const config = parseCorsConfig({ MCP_CORS_ORIGINS: '*', MCP_CORS_ALLOW_WILDCARD: 'true' });
  assertEqual(config, { origins: ['*'], wildcard: true }, 'wildcard');
});

run('"*" misturado com origens explicitas aborta (mesmo com opt-in)', () => {
  assertThrows(
    () => parseCorsConfig({ MCP_CORS_ORIGINS: '*,https://a.com', MCP_CORS_ALLOW_WILDCARD: 'true' }),
    'deveria abortar'
  );
});

run('"*" dentro de uma origem aborta (cors compara por igualdade estrita)', () => {
  assertThrows(
    () => parseCorsConfig({ MCP_CORS_ORIGINS: 'https://*.example.com' }),
    'deveria abortar'
  );
});

run('MCP_CORS_ALLOW_WILDCARD invalido aborta', () => {
  assertThrows(() => parseCorsConfig({ MCP_CORS_ALLOW_WILDCARD: 'yes' }), 'deveria abortar');
});

run('opt-in sem "*" permanece allowlist (flag e apenas permissao)', () => {
  const config = parseCorsConfig({
    MCP_CORS_ORIGINS: 'https://a.com',
    MCP_CORS_ALLOW_WILDCARD: 'true',
  });
  assertEqual(config, { origins: ['https://a.com'], wildcard: false }, 'allowlist');
});

// ---- createCorsOptions ------------------------------------------------------

console.log('createCorsOptions:');

run('modo allowlist: reflete lista, credentials true', () => {
  const options = createCorsOptions({ origins: ['https://a.com'], wildcard: false });
  assertEqual(options.origin, ['https://a.com'], 'origin');
  assertEqual(options.credentials, true, 'credentials');
  assertEqual(options.methods, ['GET', 'POST', 'OPTIONS'], 'methods');
  assertEqual(options.allowedHeaders, ['Content-Type', 'Authorization'], 'allowedHeaders');
});

run('modo wildcard: origin "*", credentials false', () => {
  const options = createCorsOptions({ origins: ['*'], wildcard: true });
  assertEqual(options.origin, '*', 'origin');
  assertEqual(options.credentials, false, 'credentials');
  assertEqual(options.methods, ['GET', 'POST', 'OPTIONS'], 'methods');
  assertEqual(options.allowedHeaders, ['Content-Type', 'Authorization'], 'allowedHeaders');
});

// ---- resumo -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
