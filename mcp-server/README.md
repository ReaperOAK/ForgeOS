# ForgeOS MCP Server

<!-- last_reviewed: 2026-03-10T21:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The ForgeOS MCP Server is a Python-based [Model Context Protocol](https://modelcontextprotocol.io/) server that provides ticket lifecycle management for the ForgeOS multi-agent orchestration platform.

## Prerequisites

- **Python** ≥ 3.10
- **PostgreSQL** 17 (optional for initial bootstrap — server starts without DB)
- **uv** (recommended) or **pip** for dependency management

## Quick Start

### 1. Install dependencies

Using [uv](https://docs.astral.sh/uv/) (recommended):

```bash
cd mcp-server
uv pip install -e ".[dev]"
```

Using pip:

```bash
cd mcp-server
pip install -e ".[dev]"
```

### 2. Configure environment (optional)

The server reads configuration from environment variables with the `FORGEOS_` prefix. Defaults are suitable for local development.

| Variable | Default | Description |
|---|---|---|
| `FORGEOS_HOST` | `0.0.0.0` | Bind address |
| `FORGEOS_PORT` | `8080` | Bind port |
| `FORGEOS_LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `FORGEOS_DATABASE_URL` | `postgresql://forgeos:forgeos@localhost:5432/forgeos` | PostgreSQL connection URI |
| `FORGEOS_DB_MIN_POOL_SIZE` | `2` | Minimum connection pool size |
| `FORGEOS_DB_MAX_POOL_SIZE` | `10` | Maximum connection pool size |

### 3. Start the server

Using the entry point script:

```bash
forgeos-mcp
```

Using Python module invocation:

```bash
python -m mcp_server
```

The server starts with **Streamable HTTP** transport on `http://0.0.0.0:8080/mcp` by default.

### 4. Verify the server is running

Connect with the MCP Python client:

```python
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def check():
    async with streamable_http_client("http://localhost:8080/mcp") as (r, w, _):
        async with ClientSession(r, w) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(f"Connected! Tools: {[t.name for t in tools.tools]}")

asyncio.run(check())
```

## Development

### Run tests

```bash
pytest --cov=mcp_server --cov-report=term-missing
```

### Lint and type check

```bash
ruff check src/ tests/
pyright src/
```

## Architecture

The server uses the **FastMCP** high-level API from the [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk):

- **`mcp_server/server.py`** — Server initialization, configuration, error handling, entry point
- **`mcp_server/__init__.py`** — Package metadata (version, app name)
- **`mcp_server/__main__.py`** — `python -m mcp_server` entry point

### Error Handling

Domain errors extend `ForgeOSError` and map to standard JSON-RPC error codes:

| Error Class | JSON-RPC Code | HTTP Equivalent |
|---|---|---|
| `TicketNotFoundError` | `-32602` | 404 |
| `TicketAlreadyClaimedError` | `-32602` | 409 |
| `ValidationError` | `-32602` | 400 |
| `DatabaseError` | `-32603` | 503 |

Tool-level expected failures use `isError=True` in the MCP `CallToolResult`.

### Transport

The server uses **Streamable HTTP** transport in stateless mode (`stateless_http=True`), which:
- Requires no server-side session state
- Returns JSON responses (no SSE streaming)
- Supports horizontal scaling behind a load balancer


## Database Migrations

ForgeOS uses [Alembic](https://alembic.sqlalchemy.org/) for PostgreSQL schema
management. All migration configuration lives under `mcp-server/alembic/`.

### Configuration

Alembic reads the database URL from the `DATABASE_URL` environment variable
(same source as the runtime server):

```bash
export DATABASE_URL="postgresql+asyncpg://forgeos:forgeos@localhost:5432/forgeos"
```

### Running migrations

```bash
cd mcp-server

# Apply all pending migrations
alembic upgrade head

# Roll back one revision
alembic downgrade -1

# Show migration history
alembic history --verbose

# Generate offline SQL (for DBA review)
alembic upgrade head --sql
```

### Creating a new migration

```bash
alembic revision -m "short_description"
```

Alembic stamps each revision file with an ISO-8601 timestamp via the custom
template in `alembic/script.py.mako`.

### Initial schema (revision 001)

The first migration creates the full ForgeOS ticket-management schema:

| Category | Objects |
|---|---|
| Enum types | `ticket_status`, `ticket_type`, `ticket_priority`, `sdlc_stage`, `agent_type` |
| Tables | `tickets`, `ticket_events`, `agents`, `agent_assignments`, `sdlc_transitions`, `system_config`, `audit_log` |
| Triggers | `set_updated_at` on every table with an `updated_at` column |
| Indexes | B-tree, GIN (jsonb), and partial indexes for query performance |
| Seed data | Default row in `system_config` |

### Project structure

```
mcp-server/
  alembic.ini              # Alembic configuration
  alembic/
    env.py                 # Async migration runner (asyncpg)
    script.py.mako         # Timestamped revision template
    versions/
      001_initial_schema.py
  src/mcp_server/
    db/
      __init__.py           # Public re-exports (16 symbols)
      connection.py         # DatabaseConfig, URL helpers, engine factories
      migration_helpers.py  # Enum / trigger / index DDL utilities
```

### Database module API

| Export | Source | Purpose |
|---|---|---|
| `DatabaseConfig` | `connection` | Pydantic-settings model for DB configuration |
| `get_database_url` | `connection` | Read `DATABASE_URL` from environment |
| `convert_to_asyncpg_url` | `connection` | Convert URL to `asyncpg` dialect |
| `convert_to_psycopg2_url` | `connection` | Convert URL to `psycopg2` dialect |
| `create_async_engine` | `connection` | Build async SQLAlchemy engine |
| `create_sync_engine` | `connection` | Build sync SQLAlchemy engine |
| `create_enum_type` | `migration_helpers` | Emit `CREATE TYPE ... AS ENUM` |
| `drop_enum_type` | `migration_helpers` | Emit `DROP TYPE IF EXISTS` |
| `create_updated_at_trigger` | `migration_helpers` | Attach auto-update trigger |
| `drop_updated_at_trigger` | `migration_helpers` | Remove auto-update trigger |
| `create_updated_at_function` | `migration_helpers` | Install `set_updated_at()` PL/pgSQL |
| `drop_updated_at_function` | `migration_helpers` | Remove `set_updated_at()` function |
| `create_index` | `migration_helpers` | Create index with existence check |
| `drop_index` | `migration_helpers` | Drop index with existence check |
| `create_partial_index` | `migration_helpers` | Create filtered index |
| `create_gin_index` | `migration_helpers` | Create GIN index for JSONB |

## License

MIT
