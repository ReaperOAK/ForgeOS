# MCP Cutover — L1 Capabilities

Source: takeover artifacts and TODO seed (2026-04)

High-level capabilities required to complete the ForgeOS MCP-first Copilot cutover:

- Capability 1: MCP-First Operator Flow — Make ForgeOS MCP the authoritative control plane for ticketing, context, and operator prompts.
- Capability 2: Secure Operator Auth & Identity — Remove checked-in credentials; bind ticket mutations to authenticated principals.
- Capability 3: Tooling & Contract Drift Prevention — Auto-generate tool manifests and CI guardrails to prevent drift back to legacy filesystem workflows.
- Capability 4: Operator Experience — Quick-start, doctor, and smoke-check flows for VS Code Copilot operators.
- Capability 5: Installer & Repo Onboarding — One-click installer to add `.github` assets + optional local MCP dev setup to an existing repo.
- Capability 6: Production-Ready Deployment — Full Dockerization and deployment artifacts for ForgeOS MCP and essential supporting services.
- Capability 7: Migration & Compatibility — Clear migration path and guarded compatibility mode for repositories still using legacy `tickets.py` or `ticket-state/`.

Confidence: HIGH — derived from takeover artifacts and existing TODO seed.
