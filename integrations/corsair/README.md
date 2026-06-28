# ForgeOS × Corsair — Issue Ingestion Connector

Turn **GitHub Issues into ForgeOS "warm" tickets** using
[Corsair](https://corsair.dev/), the open-source integration layer for AI agents.

This is the ingestion edge of ForgeOS's thesis: *the moment an issue is filed,
agents pre-investigate it* — so an engineer opens work that's already structured,
typed, prioritized, and queued into the SDLC, instead of a cold ticket.

```
GitHub Issue ──(Corsair GitHub plugin)──▶ connector ──▶ tickets/<id>.json
      ▲                                       │              │
      │  🤖 write-back comment (--comment)     │   python tickets.py --sync
      └───────────────────────────────────────┘              ▼
                                              ticket-state/READY/ (warm ticket)
                                                            │
                                              ForgeOS SDLC agents take over
```

## Why Corsair

The connector never touches OAuth, tokens, webhooks, or rate limits — Corsair's
GitHub plugin handles all of it. It also **closes the loop**: after ingesting an
issue it posts a comment back via `corsair.github.api.issues.createComment`.
Swapping in **Linear** as an issue source is a new `IssueSource` behind the same
interface (`--source linear`), not new auth plumbing.

## Install & test (offline — no account needed)

```bash
cd integrations/corsair
npm install
npm test                 # 38 tests, zero network
npm run test:coverage    # connector.ts ≥ 90% (currently ~97%)
npm run build            # clean tsc --strict → dist/
```

The mocked-Corsair, schema-parity, Python state-machine acceptance, and CLI
smoke tests all run **offline**. The one live test self-skips unless
`CORSAIR_KEK` is set.

## Demo (offline)

```bash
# preview the mapping, write nothing
npx tsx src/cli.ts --owner reaperoak --repo ForgeOS --fake --dry-run --tickets-dir /tmp/demo

# actually write the tickets + show a write-back comment (in-memory for --fake)
npx tsx src/cli.ts --owner reaperoak --repo ForgeOS --fake --comment --tickets-dir /tmp/demo
cat /tmp/demo/GH-FORGEOS-101.json
```

## Go live with Corsair

```bash
npm install corsair @corsair-dev/github better-sqlite3
npx corsair setup --plugin=github api_key=$GITHUB_TOKEN --backfill
cp .env.example .env      # set CORSAIR_KEK (loaded automatically via dotenv)

# ingest real open issues, refresh changed ones, comment back, queue into ForgeOS
npx tsx src/cli.ts --owner <org> --repo <name> --state open \
    --update --comment --limit 200 --sync
```

`--sync` runs `python tickets.py --sync` to move new tickets into
`ticket-state/READY/`.

## CLI flags

| Flag | Default | Effect |
|---|---|---|
| `--owner` / `--repo` | `example`/`repo` | source repository |
| `--state` | `open` | `open` · `closed` · `all` |
| `--source` | `github` | issue source plugin (`github` \| `linear`) |
| `--fake` | off | use built-in sample issues (no Corsair/network) |
| `--tickets-dir` | `<repo-root>/tickets` | output dir |
| `--limit N` | ∞ | cap issues processed (also stops Corsair paging early) |
| `--update` | off | refresh existing tickets when the issue changed |
| `--comment` | off | post a 🤖 write-back comment per ingested issue |
| `--dry-run` | off | map + print only; write nothing, comment nothing |
| `--sync` | off | run `python tickets.py --sync` afterward |

## How it maps an issue → ForgeOS ticket

| Issue input | ForgeOS field | Rule |
|---|---|---|
| `title` | `title` | verbatim |
| `body` | `description` | verbatim (falls back to title) |
| `body` `- [ ]` checklist | `acceptance_criteria` | parsed; else `Resolve issue: <title>` |
| `body`/`title` paths (`` `src/x.ts` ``, `a/b/c.py`) | `file_paths` | extracted, URLs ignored, de-duped |
| `assignee` | `operator` | login → operator (nullable) |
| `milestone` | `tags` | `milestone:<slug>` |
| `labels` | `type` | security/docs/infra/research/architecture/frontend/fullstack → else **backend** |
| `labels` | `priority` | p0/critical → critical · high → high · minor → low · else **medium** |
| `labels` | `tags` | labels + `github` + `corsair-ingest` (+ milestone) |
| `number` + repo | `ticket_id` | `GH-<REPO>-<number>` (stable, filesystem-safe) |
| `htmlUrl` | `source_task_file` | traceability back to the issue |

The output JSON matches `tickets.py::create_ticket` (22 keys) — a **schema-parity
test** asserts the generated key set equals a real `tickets/*.json` and fails
loudly on drift. Ingested tickets are indistinguishable from natively-created
ones to the state machine and SDLC agents.

**Idempotency & update mode.** Re-running skips existing ticket files. With
`--update`, a ticket whose upstream issue changed (title/body/labels/priority/
type/paths) is refreshed in place — preserving `created_at`, claim/lease fields,
the current `stage`, and `history` (an `UPDATED` event is appended).

## Write-back (closing the loop)

After a ticket is created, `--comment` posts to the source issue via
`corsair.github.api.issues.createComment`:

```
🤖 ForgeOS ingested this issue → ticket `GH-FORGEOS-101`
- type: `backend`
- priority: `high`
- stage: `READY` (queued into the SDLC)
```

This is the strongest "meaningful Corsair use" signal — a two-way integration,
not a read-only scrape. It is mocked + asserted in the test suite.

## Architecture

- `src/connector.ts` — pure mapping + update-merge + `IssueSource`
  (Fake / Corsair / Linear) + `CommentSink` (Fake / Corsair) + `ingest()`
- `src/cli.ts` — `forgeos-corsair` CLI
- `src/__tests__/connector.test.ts` — pure-helper + ingest-mode unit tests
- `src/__tests__/corsair.test.ts` — mocked-Corsair integration, schema parity,
  Python state-machine acceptance (end-to-end), CLI smoke, live skip-if test

Corsair dependencies (`corsair`, `@corsair-dev/github`, `better-sqlite3`,
`@corsair-dev/linear`) are **lazy-imported**, so the package installs, builds,
and tests with no native or network dependencies until you choose to go live.
Secrets (`CORSAIR_KEK`, tokens) are never logged.
