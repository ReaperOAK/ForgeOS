# FORGEOS-RES003 — Research Summary: MCP Python SDK Maturity Evaluation

**Agent:** Research Analyst
**Stage:** RESEARCH → DOCS
**Date:** 2026-03-05
**Confidence:** 82% (HIGH)

## Key Findings

1. **API Surface:** Comprehensive. FastMCP provides decorator-based tool/resource/prompt registration, Streamable HTTP transport, stateful/stateless sessions, OAuth 2.1 auth, client API with pagination, structured output, elicitation, and tasks support. Full parity with TypeScript SDK for all ForgeOS requirements.

2. **Async/Await:** Built on `anyio>=4.5` (runs on asyncio). Fully async architecture with structured concurrency. Compatible with ForgeOS's asyncio-based server. Context object provides async methods for progress reporting, logging, resource reading, and sampling.

3. **Error Handling:** `McpError` base exception wrapping `ErrorData` (code + message + data). Standard JSON-RPC error codes (-32700 to -32603) plus MCP-specific codes (CONNECTION_CLOSED=-32000, URL_ELICITATION_REQUIRED=-32042). Tools can signal errors via `CallToolResult.isError=True`. No built-in retry — ForgeOS must implement.

4. **Typing:** Pyright strict mode enforced. 110+ Pydantic v2 models covering the entire MCP protocol surface. Generic types, TypeAlias, Literal types, Annotated constraints.

5. **Test Coverage:** 100% enforcement (`fail_under = 100`). pytest + pytest-xdist for parallel execution. Tests across Python 3.10-3.13.

6. **Release Cadence:** 53 releases, ~2-4 week cadence. v1.26.0 (Jan 25, 2026) is latest. v1.x in maintenance mode (security + critical fixes). v2.0 in pre-alpha on `main` branch.

7. **Repository Health:** 22k stars, 3.1k forks, 189 contributors, MIT license, Anthropic-backed, no critical CVEs.

8. **Known Issues:** 248 open issues (mostly v2 feature requests). No built-in retry/reconnect. "Beta" PyPI classifier despite production maturity. v2 migration path unclear.

## Recommendation

**ADOPT for Python-based ForgeOS components. RETAIN TypeScript SDK for existing server.**

- Pin `mcp>=1.25,<2`
- Implement custom retry/circuit-breaker
- Monitor v2 development; plan migration when v2 reaches beta
- No full server migration needed — use Python SDK for new Python services/clients

## Artifacts

- Full report: `docs/research/mcp-sdk-evaluation.md`

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| SDK API surface cataloged | ✅ Sections 3.1-3.6 |
| Async/await support assessed | ✅ Section 4 |
| Error handling patterns evaluated | ✅ Section 5 |
| Release cadence documented | ✅ Section 8 |
| Known issues cataloged | ✅ Section 10 |
| Gap analysis | ✅ Section 11 |
| Report at docs/research/mcp-sdk-evaluation.md | ✅ Delivered |
