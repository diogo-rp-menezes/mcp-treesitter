# Production Readiness Audit Report

**Project:** MCP Tree-sitter Server  
**Date:** 2026-10-02  
**Auditor:** Production Code Audit Mode  
**Scope:** Full-spectrum audit across architecture, security, performance, code quality, testing, and production readiness

---

## Executive Summary

The MCP Tree-sitter Server is a TypeScript/Node.js-based Model Context Protocol server providing code analysis capabilities via tree-sitter. The codebase demonstrates solid architectural foundations with proper project isolation, AST parsing for multiple languages, and a comprehensive MCP tool surface. However, several critical and high-severity findings must be addressed before production deployment.

**Overall Risk Rating:** **HIGH** — Multiple security and operational gaps require remediation.

---

## Findings by Category

### 🔴 CRITICAL

#### SEC-01: Command Injection via `execSync` in Git Operations
**Location:** [`src/server/git.ts:56-57`](src/server/git.ts:56), [`src/server/git.ts:79-81`](src/server/git.ts:79), [`src/server/git.ts:96-98`](src/server/git.ts:96), [`src/server/git.ts:123-125`](src/server/git.ts:123), [`src/server/git.ts:146-148`](src/server/git.ts:146), [`src/server/git.ts:197-199`](src/server/git.ts:197)  
**Impact:** Arbitrary command execution if `projectPath` is attacker-controlled  
**Evidence:** `execSync('git rev-parse --is-inside-work-tree', { cwd: targetPath })` and similar calls use unsanitized `targetPath` derived from user input via `projectStore.getProject().path`  
**Remediation:** Use a proper Git library (e.g., `isomorphic-git` or `simple-git`) instead of shelling out; if `execSync` must remain, validate `targetPath` against an allowlist of known project roots

#### SEC-02: No Authentication/Authorization on MCP Endpoints
**Location:** [`server.ts:502-630`](server.ts:502) — entire `/api/mcp` handler  
**Impact:** Any network caller can invoke all 15 MCP tools, read/write project files, execute queries, scan directories  
**Evidence:** No auth middleware, no token validation, no role-based access control on JSON-RPC methods  
**Remediation:** Implement MCP-compatible auth (Bearer tokens, mTLS, or OAuth2); add middleware to validate credentials before tool execution

#### SEC-03: Path Traversal in `/api/scan-directory`
**Location:** [`server.ts:108-227`](server.ts:108)  
**Impact:** Directory traversal to arbitrary filesystem locations via `dirPath` parameter  
**Evidence:** `path.resolve(dirPath)` with only `fs.existsSync` check; no validation that path is within allowed roots  
**Remediation:** Restrict scanning to configured workspace roots; validate `dirPath` against allowlist; reject absolute paths outside workspace

---

### 🟠 HIGH

#### SEC-04: CORS Misconfiguration — Wildcard Origin
**Location:** [`server.ts:21`](server.ts:21)  
**Impact:** Any website can make authenticated requests to the MCP server  
**Evidence:** `app.use(cors())` with no origin restrictions  
**Remediation:** Configure CORS with explicit allowed origins; disable credentials for wildcard

#### SEC-05: Missing Input Validation on MCP Tool Arguments
**Location:** [`src/server/mcp.ts:200-395`](src/server/mcp.ts:200) — `handleMCPToolCall`  
**Impact:** Malformed arguments can cause crashes or unexpected behavior  
**Evidence:** Direct destructuring of `args` without schema validation (e.g., `args.project`, `args.path`, `args.query`)  
**Remediation:** Add Zod/Joi schemas for each tool's `inputSchema`; validate at MCP entry point

#### SEC-06: No Rate Limiting on Public Endpoints
**Location:** [`server.ts:16-670`](server.ts:16) — entire Express app  
**Impact:** DoS via unbounded request volume; resource exhaustion on `/api/scan-directory`, `/api/mcp`  
**Evidence:** No `express-rate-limit` or similar middleware  
**Remediation:** Add rate limiting per IP/project; stricter limits on expensive operations

#### ARCH-01: God Class — `server.ts` (677 lines)
**Location:** [`server.ts`](server.ts:1)  
**Impact:** Single file handles HTTP routing, MCP protocol, project management, file ops, AST, queries, complexity, similarity, Git, SSE — violates Single Responsibility Principle  
**Evidence:** 30+ route handlers in one file; tight coupling between HTTP layer and business logic  
**Remediation:** Extract route modules (`projects.routes.ts`, `mcp.routes.ts`, `analysis.routes.ts`); use dependency injection for services

#### ARCH-02: Singleton Global State — `projectStore`
**Location:** [`src/server/store.ts:6`](src/server/store.ts:6), [`src/server/store.ts:225`](src/server/store.ts:225)  
**Impact:** Shared mutable state across requests; not horizontally scalable; test pollution  
**Evidence:** `const projects = new Map<string, Project>()` at module level; exported singleton `projectStore`  
**Remediation:** Encapsulate in a class with explicit lifecycle; inject per-request or per-session context

#### PERF-01: No Parse Tree Caching Implementation
**Location:** [`src/server/mcp.ts:373-375`](src/server/mcp.ts:373) — `clear_cache` tool returns stub  
**Impact:** Re-parsing same files on every request; CPU/memory waste  
**Evidence:** Config mentions `cache.enabled`, `max_size_mb`, `ttl_seconds` but no cache layer in parser/store  
**Remediation:** Implement LRU cache with TTL in `parseSourceToAST`; integrate with `clear_cache` tool

#### PERF-02: N+1 Parsing in `getProjectOverview`
**Location:** [`src/server/store.ts:247-296`](src/server/store.ts:247)  
**Impact:** Re-parses every file in project on each overview call  
**Evidence:** Loop calls `parseSourceToAST` and `extractSymbolsFromAST` per file without memoization  
**Remediation:** Cache parsed ASTs and symbol extracts; invalidate on file change

#### PERF-03: O(n²) Similarity Algorithm
**Location:** [`src/server/similarity.ts:32-83`](src/server/similarity.ts:32)  
**Impact:** Quadratic complexity for large projects; blocks event loop  
**Evidence:** `findSimilarCodeBlocks` parses every candidate file and walks entire AST for each snippet  
**Remediation:** Pre-compute fingerprints; use worker threads; add pagination/streaming

---

### 🟡 MEDIUM

#### CODE-01: Custom AST Parser Instead of tree-sitter WASM
**Location:** [`src/server/parser.ts`](src/server/parser.ts:1) — 600+ lines of hand-rolled parsers  
**Impact:** Incomplete language support; maintenance burden; diverges from real tree-sitter behavior  
**Evidence:** Regex-based parsing for Python, JS/TS, Go, Rust; no actual tree-sitter integration in TypeScript layer  
**Remediation:** Migrate to `@tree-sitter/node` or `tree-sitter-language-pack` WASM bindings; remove custom parsers

#### CODE-02: `any` Type Usage in Public APIs
**Location:** [`src/server/mcp.ts:200`](src/server/mcp.ts:200), [`src/server/mcp.ts:397`](src/server/mcp.ts:397), [`src/client/types.ts:161`](src/client/types.ts:161)  
**Impact:** Type safety gaps; runtime errors not caught at compile time  
**Evidence:** `args: Record<string, any>`, `Promise<any>`, `invokeTool<T = any>`  
**Remediation:** Define strict input/output types per tool; use `z.infer<typeof schema>` pattern

#### CODE-03: Error Handling Swallows Context
**Location:** [`src/server/store.ts:89-91`](src/server/store.ts:89), [`src/server/store.ts:212-214`](src/server/store.ts:212)  
**Impact:** Silent failures hide bugs; debugging difficult  
**Evidence:** `catch { /* skip if path violates isolation */ }` with no logging  
**Remediation:** Log at `warn` level with context; re-throw or return structured error

#### CODE-04: Console Logging in Production Code
**Location:** [`src/server/store.ts:112-114`](src/server/store.ts:112), [`server.ts:667-669`](server.ts:667)  
**Impact:** No structured logging; no log levels; pollutes stdout  
**Evidence:** `console.log('Code updated, AST ready for inspection')`, `console.log('[MCP Tree-sitter] Server running...')`  
**Remediation:** Use structured logger (pino/winston) with levels; respect `MCP_TS_LOG_LEVEL`

#### CODE-05: Duplicated Request Handling Pattern
**Location:** [`server.ts:300-482`](server.ts:300) — 6 endpoints with identical `project+path` → `code+lang` resolution  
**Impact:** Copy-paste bugs; inconsistent error handling; maintenance overhead  
**Evidence:** Repeated `if (!source && project && path) { const f = projectStore.getFile... }` blocks  
**Remediation:** Extract to middleware or helper: `resolveSource(req, res, next)`

#### TEST-01: No Test Files Found in Repository
**Location:** Repository root  
**Impact:** Zero test coverage verification; CI cannot validate correctness  
**Evidence:** `pytest tests` in CI but no `tests/` directory exists in TypeScript codebase  
**Remediation:** Add Vitest/Jest for TypeScript; target >80% coverage on critical paths (isolation, parsing, MCP tools)

#### TEST-02: CI References Python Tests Not Present
**Location:** [`.github/workflows/ci.yml:60-61`](.github/workflows/ci.yml:60), [`.github/workflows/ci.yml:73-74`](.github/workflows/ci.yml:73)  
**Impact:** CI passes vacuously; false confidence  
**Evidence:** `pytest tests` and `pytest tests/test_diagnostics/` but no Python source in repo  
**Remediation:** Align CI with actual stack (TypeScript/Node); replace with `vitest run` or `npm test`

#### OPS-01: No Health Check Dependencies
**Location:** [`server.ts:24-33`](server.ts:24)  
**Impact:** `/api/health` returns `ok` even if parser, Git, or project store are broken  
**Evidence:** Health check only returns static JSON with uptime  
**Remediation:** Add liveness/readiness probes checking: parser init, project store accessible, Git binary present

#### OPS-02: No Structured Logging / Observability
**Location:** Entire codebase  
**Impact:** Cannot debug production issues; no correlation IDs; no metrics export  
**Evidence:** Only `console.log/error`; no request IDs, no OpenTelemetry, no Prometheus metrics  
**Remediation:** Add pino logger with child loggers per request; expose `/metrics` endpoint; add trace IDs

#### OPS-03: No Graceful Shutdown Handling
**Location:** [`server.ts:673-676`](server.ts:673)  
**Impact:** In-flight requests dropped on deploy/scale-down; SSE connections leaked  
**Evidence:** `process.exit(1)` on startup error only; no `SIGTERM`/`SIGINT` handlers  
**Remediation:** Add signal handlers; drain HTTP server; close SSE intervals; flush logs

#### OPS-04: Hardcoded Configuration Defaults
**Location:** [`server.ts:18`](server.ts:18), [`src/server/mcp.ts:378-382`](src/server/mcp.ts:378)  
**Impact:** Environment-specific config requires code changes; no validation  
**Evidence:** `PORT=3000`, `cache: { enabled: true, max_size_mb: 100 }` hardcoded  
**Remediation:** Centralize config with schema validation (Zod); load from env + YAML; fail fast on invalid

#### OPS-05: Missing API Versioning
**Location:** [`server.ts:520-530`](server.ts:520) — MCP `initialize` returns `protocolVersion: '2024-11-05'`  
**Impact:** Breaking changes cannot be rolled out safely  
**Evidence:** No version prefix on REST endpoints (`/api/*`); MCP version fixed  
**Remediation:** Version REST API (`/api/v1/...`); negotiate MCP protocol version

---

### 🟢 LOW

#### CODE-06: Dead Code in `store.ts` — Embedded Python/TS/Go/Rust Samples
**Location:** [`src/server/store.ts:17-208`](src/server/store.ts:17)  
**Impact:** Bloats bundle; confusing; not used in production  
**Evidence:** `initDefaultProjects()` creates demo files with hardcoded source strings  
**Remediation:** Move to test fixtures or separate demo script

#### CODE-07: Inconsistent Naming — `project` vs `name` vs `projectName`
**Location:** [`src/server/mcp.ts`](src/server/mcp.ts:1) — tool args use `project`, `name`, `projectName` interchangeably  
**Impact:** Cognitive load; bugs from wrong parameter  
**Remediation:** Standardize on `projectName` across all tools

#### CODE-08: Magic Numbers in Complexity Calculation
**Location:** [`src/server/complexity.ts:26`](src/server/complexity.ts:26), [`src/server/complexity.ts:51-63`](src/server/complexity.ts:51)  
**Impact:** Thresholds not configurable; language-agnostic heuristics  
**Remediation:** Move thresholds to config; allow per-language tuning

#### DOC-01: Architecture Docs Describe Python Codebase
**Location:** [`docs/architecture.md`](docs/architecture.md:1)  
**Impact:** Misleading for TypeScript contributors; references non-existent modules (`bootstrap/`, `di.py`, `config.py`)  
**Remediation:** Update docs to reflect actual TypeScript architecture

#### DOC-02: No API Documentation for REST Endpoints
**Location:** [`server.ts`](server.ts:1) — 30+ endpoints undocumented  
**Impact:** Frontend/backend contract unclear; integration difficult  
**Remediation:** Add OpenAPI/Swagger spec; generate from route definitions

---

## Prioritized Fix Order

| Priority | ID | Category | Effort | Risk Reduction |
|----------|-----|----------|--------|----------------|
| 1 | SEC-01 | Security | Medium | Critical RCE vector |
| 2 | SEC-02 | Security | Medium | Full API exposure |
| 3 | SEC-03 | Security | Low | Filesystem access |
| 4 | SEC-04 | Security | Low | CSRF/data leak |
| 5 | SEC-05 | Security | Medium | Input validation |
| 6 | SEC-06 | Security | Low | DoS protection |
| 7 | ARCH-01 | Architecture | High | Maintainability |
| 8 | ARCH-02 | Architecture | Medium | Scalability |
| 9 | PERF-01 | Performance | Medium | CPU/memory |
| 10 | PERF-02 | Performance | Low | Latency |
| 11 | PERF-03 | Performance | High | Scalability |
| 12 | CODE-01 | Code Quality | High | Correctness |
| 13 | CODE-02 | Code Quality | Medium | Type safety |
| 14 | CODE-03 | Code Quality | Low | Debuggability |
| 15 | CODE-04 | Code Quality | Low | Observability |
| 16 | CODE-05 | Code Quality | Medium | Maintainability |
| 17 | TEST-01 | Testing | High | Confidence |
| 18 | TEST-02 | Testing | Low | CI integrity |
| 19 | OPS-01 | Operations | Low | Reliability |
| 20 | OPS-02 | Operations | Medium | Debuggability |
| 21 | OPS-03 | Operations | Low | Reliability |
| 22 | OPS-04 | Operations | Low | Config management |
| 23 | OPS-05 | Operations | Low | API evolution |
| 24 | CODE-06 | Code Quality | Low | Bundle size |
| 25 | CODE-07 | Code Quality | Low | Consistency |
| 26 | CODE-08 | Code Quality | Low | Configurability |
| 27 | DOC-01 | Documentation | Low | Onboarding |
| 28 | DOC-02 | Documentation | Medium | Integration |

---

## Segregation of Duties — Handoff Plan

| Finding | Specialist Mode | Verification Mode |
|---------|-----------------|-------------------|
| SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06 | Security Reviewer → Backend Specialist (fix) → Security Reviewer (re-verify) |
| ARCH-01, ARCH-02 | Architect → Software Engineer (refactor) → Code Reviewer |
| PERF-01, PERF-02, PERF-03 | Backend Specialist → Observability Specialist (metrics) |
| CODE-01, CODE-02, CODE-03, CODE-04, CODE-05 | TypeScript Specialist → Code Reviewer |
| TEST-01, TEST-02 | Vitest Test Engineer → Code Reviewer |
| OPS-01, OPS-02, OPS-03, OPS-04, OPS-05 | Observability Specialist → DevOps |
| DOC-01, DOC-02 | Documentation Writer → Code Reviewer |

---

## Compliance Notes

- **OWASP Top 10 Coverage:** A01 (Broken Access Control) — SEC-02, SEC-03; A03 (Injection) — SEC-01, SEC-05; A05 (Security Misconfiguration) — SEC-04, SEC-06; A07 (Identification/Authentication Failures) — SEC-02
- **No SBOM/Dependency Audit Performed** — recommend `npm audit` and `cyclonedx-bom` in CI
- **No Container Hardening Reviewed** — no `Dockerfile` found; if containerized, review base image, user, capabilities

---

## Sign-off

This audit report is delivered for stakeholder review. No findings are marked "done" — each requires specialist implementation and independent verification per the handoff plan above.

**Next Steps:**
1. Stakeholder prioritizes top 5 Critical/High items
2. Orchestrator delegates to specialist modes via `new_task`
3. Each fix verified by independent reviewer before merge
4. Re-audit after Critical/High remediation complete