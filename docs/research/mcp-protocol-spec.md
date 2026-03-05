# MCP Protocol Core Specification — Research Report

> **Ticket:** FORGEOS-RES001 | **Agent:** Research Analyst | **Date:** 2026-03-05  
> **Confidence:** HIGH (92%) | **Validity Window:** 6 months (until 2026-09-05)  
> **Protocol Revision Analyzed:** 2025-03-26  
> **SDK Version in ForgeOS:** `@modelcontextprotocol/sdk ^1.27.1`

---

## Executive Summary

The Model Context Protocol (MCP) is an open, transport-agnostic protocol built on **JSON-RPC 2.0** that standardizes communication between AI/LLM host applications (clients) and context-providing servers. MCP defines three server-side primitives — **Tools**, **Resources**, and **Prompts** — along with a rigorous **session lifecycle** (initialize → operate → shutdown) with explicit capability negotiation.

This report documents the protocol's core semantics at spec revision `2025-03-26` and evaluates MCP's fitness for ForgeOS agent-to-server orchestration. **Conclusion: MCP is an excellent fit** for ForgeOS's distributed ticket management, with the existing `forgeos-server` already implementing Streamable HTTP transport and 10 MCP tools. The protocol's tool-centric design maps directly to ForgeOS's ticket operations, and capability negotiation allows incremental feature adoption.

**Bayesian Confidence Update:**  
- *Prior:* 75% — MCP is likely a good fit for agent-to-server communication based on its growing adoption and JSON-RPC foundation.  
- *Posterior:* 92% — Multiple independent sources confirm strong alignment. Protocol semantics map cleanly to ForgeOS operations. The existing `forgeos-server` implementation validates the approach. Minor gaps exist in batch orchestration and multi-agent coordination, but these are addressable at the application layer.

---

## Table of Contents

1. [Protocol Overview and Architecture](#1-protocol-overview-and-architecture)
2. [JSON-RPC 2.0 Message Format](#2-json-rpc-20-message-format)
3. [Tool Registration and Discovery](#3-tool-registration-and-discovery)
4. [Resource Model](#4-resource-model)
5. [Prompt Template Model](#5-prompt-template-model)
6. [Session Lifecycle](#6-session-lifecycle)
7. [Transport Options](#7-transport-options)
8. [Fitness Assessment for ForgeOS](#8-fitness-assessment-for-forgeos)
9. [Contradictions and Open Questions](#9-contradictions-and-open-questions)
10. [Recommendations](#10-recommendations)
11. [Sources and Evidence Chain](#11-sources-and-evidence-chain)

---

## 1. Protocol Overview and Architecture

**Source:** [MCP Specification — Overview](https://modelcontextprotocol.io/specification/2025-03-26/basic) (weight: 1.0, official spec)

MCP is structured as a layered protocol:

| Layer | Description | Required? |
|-------|-------------|-----------|
| **Base Protocol** | Core JSON-RPC 2.0 message types (request, response, notification) | MUST |
| **Lifecycle Management** | Connection initialization, capability negotiation, session control | MUST |
| **Server Features** | Resources, prompts, and tools exposed by servers | MAY |
| **Client Features** | Sampling and root directory lists provided by clients | MAY |
| **Utilities** | Cross-cutting: logging, argument completion, cancellation, progress, ping | MAY |

### Architecture Model

MCP follows a **client-server** architecture:

```
┌─────────────────────────────────────────────────────┐
│ Host Application (e.g., IDE, AI Assistant)           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ MCP Client  │  │ MCP Client  │  │ MCP Client  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
└─────────┼───────────────┼───────────────┼──────────┘
          │               │               │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
    │ MCP Server│   │ MCP Server│   │ MCP Server│
    │ (local)   │   │ (remote)  │   │ (remote)  │
    └───────────┘   └───────────┘   └───────────┘
```

- A **host** contains one or more **MCP clients**
- Each client maintains a 1:1 session with an **MCP server**
- Servers expose **tools**, **resources**, and **prompts** to clients
- Communication is **bidirectional** — both client and server can send requests

### Key Design Principles

1. **Transport-agnostic:** Protocol works over stdio, HTTP, or custom transports
2. **Capability-driven:** Features are opt-in via negotiation at session start
3. **Stateless or stateful:** Servers may choose to be session-aware or stateless
4. **Schema-first:** Tool inputs defined via JSON Schema; full protocol defined in TypeScript/JSON Schema

---

## 2. JSON-RPC 2.0 Message Format

**Source:** [MCP Specification — Overview § Messages](https://modelcontextprotocol.io/specification/2025-03-26/basic) (weight: 1.0, official spec); [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) (weight: 1.0, standard)

All MCP messages are **JSON-RPC 2.0** and MUST be **UTF-8 encoded**. Three message types exist:

### 2.1 Request

A request initiates an operation. Either client or server can send requests.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "tickets.claim",
    "arguments": {
      "ticket_id": "FORGEOS-RES001",
      "agent_name": "Research",
      "machine_id": "pop-os"
    }
  }
}
```

**Rules:**
- `id` MUST be a string or integer, MUST NOT be `null`
- `id` MUST be unique within the session (not reused by the same requestor)
- `method` is a string identifying the operation
- `params` is an optional object

### 2.2 Response

A response replies to a request. Contains either `result` or `error`, never both.

**Successful response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Ticket FORGEOS-RES001 claimed successfully"
      }
    ],
    "isError": false
  }
}
```

**Error response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Unknown tool: invalid_tool_name",
    "data": {
      "supported": ["tickets.next", "tickets.claim"]
    }
  }
}
```

**Rules:**
- Response `id` MUST match the request `id`
- Either `result` or `error` MUST be set, never both
- Error `code` MUST be an integer; standard JSON-RPC error codes apply

### 2.3 Notification

A one-way message. The receiver MUST NOT send a response.

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
```

**Rules:**
- Notifications MUST NOT include an `id` field
- Notifications MAY include `params`

### 2.4 Batching

MCP supports JSON-RPC batching: an array of requests/notifications sent as one message.

```json
[
  {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
  {"jsonrpc": "2.0", "method": "notifications/initialized"}
]
```

**Rules:**
- Implementations MAY support sending batches
- Implementations MUST support receiving batches
- The `initialize` request MUST NOT be part of a batch

### 2.5 Standard Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32002` | Resource not found (MCP-specific) |

---

## 3. Tool Registration and Discovery

**Source:** [MCP Specification — Tools](https://modelcontextprotocol.io/specification/2025-03-26/server/tools) (weight: 1.0, official spec)

Tools are the **primary interaction mechanism** for LLMs to perform actions through MCP servers. They are **model-controlled** — the LLM discovers and invokes tools based on its contextual understanding.

### 3.1 Capability Declaration

Servers declare tool support during initialization:

```json
{
  "capabilities": {
    "tools": {
      "listChanged": true
    }
  }
}
```

- `listChanged: true` means the server will emit `notifications/tools/list_changed` when tools are added/removed

### 3.2 Tool Definition Schema

Each tool is defined with:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier (e.g., `tickets.claim`) |
| `description` | string | Yes | Human-readable description of functionality |
| `inputSchema` | JSON Schema object | Yes | Defines expected parameters |
| `annotations` | object | No | Optional properties describing tool behavior |

**Example tool definition:**
```json
{
  "name": "tickets.claim",
  "description": "Atomically claim a specific ticket by ID with file-lock conflict detection",
  "inputSchema": {
    "type": "object",
    "properties": {
      "ticket_id": {
        "type": "string",
        "description": "Ticket ID to claim"
      },
      "agent_name": {
        "type": "string",
        "description": "Agent name claiming the ticket"
      },
      "machine_id": {
        "type": "string",
        "description": "Machine hostname"
      },
      "lease_minutes": {
        "type": "number",
        "description": "Lease duration in minutes",
        "default": 30
      }
    },
    "required": ["ticket_id", "agent_name", "machine_id"]
  }
}
```

### 3.3 Tool Discovery Flow

**Step 1: Client lists available tools**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "cursor": "optional-cursor-value"
  }
}
```

Response (paginated):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "tickets.next",
        "description": "Find the next available ticket for a given SDLC stage",
        "inputSchema": { "type": "object", "properties": { "stage": { "type": "string" } } }
      },
      {
        "name": "tickets.claim",
        "description": "Atomically claim a specific ticket by ID",
        "inputSchema": { "...": "..." }
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```

**Step 2: Client invokes a tool**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "tickets.claim",
    "arguments": {
      "ticket_id": "FORGEOS-RES001",
      "agent_name": "Research",
      "machine_id": "pop-os"
    }
  }
}
```

**Step 3: Server returns result**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"ticket_id\":\"FORGEOS-RES001\",\"status\":\"claimed\"}"
      }
    ],
    "isError": false
  }
}
```

### 3.4 Tool Result Content Types

Tool results return an array of content items, supporting:

| Type | Description |
|------|-------------|
| `text` | Plain text (most common) |
| `image` | Base64-encoded image with MIME type |
| `audio` | Base64-encoded audio with MIME type |
| `resource` | Embedded resource with URI for later subscription/fetch |

### 3.5 Tool Error Reporting

Two distinct error mechanisms:

1. **Protocol errors** — standard JSON-RPC error responses (e.g., unknown tool, invalid arguments)
2. **Tool execution errors** — returned in the tool result with `isError: true`

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Failed to claim ticket: already claimed by another agent"
      }
    ],
    "isError": true
  }
}
```

### 3.6 Dynamic Tool Changes

Servers can notify clients when tools change:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
```

### 3.7 ForgeOS Tool Registration (Codebase Evidence)

The ForgeOS server registers 10 tools using the `@modelcontextprotocol/sdk` (v1.27.1):

```typescript
// From forgeos-server/src/tools/index.ts
server.tool(
  'tickets.claim',                    // name
  'Atomically claim a specific ticket by ID...', // description
  ticketsClaimSchema.shape,           // Zod schema → JSON Schema
  ticketsClaimHandler,                // handler function
);
```

The SDK's `McpServer.tool()` method registers tools with:
- **Name** — string identifier in `tickets.*` namespace
- **Description** — human-readable description
- **Schema** — Zod schema object that gets converted to JSON Schema automatically
- **Handler** — async function returning `{ content: [{type: 'text', text: string}] }`

**Registered tools:** `tickets.next`, `tickets.claim`, `tickets.update`, `tickets.complete`, `tickets.reject`, `tickets.spawn`, `tickets.graph`, `tickets.release`, `tickets.extend`, `tickets.stats`

### 3.8 Security Requirements

The spec mandates:
- Servers MUST validate all tool inputs
- Servers MUST implement proper access controls
- Servers MUST rate limit tool invocations
- Servers MUST sanitize tool outputs
- Clients SHOULD prompt for user confirmation on sensitive operations
- Clients SHOULD show tool inputs to the user before calling (prevent data exfiltration)

---

## 4. Resource Model

**Source:** [MCP Specification — Resources](https://modelcontextprotocol.io/specification/2025-03-26/server/resources) (weight: 1.0, official spec)

Resources allow servers to expose **read-only contextual data** to clients — files, database schemas, application state, etc. Resources are **application-driven** (host determines how to incorporate context), unlike tools which are **model-controlled**.

### 4.1 Capability Declaration

```json
{
  "capabilities": {
    "resources": {
      "subscribe": true,
      "listChanged": true
    }
  }
}
```

- `subscribe` — client can subscribe to individual resource change notifications
- `listChanged` — server emits notifications when the resource list changes
- Both are optional and independent

### 4.2 Resource Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uri` | string (URI) | Yes | Unique identifier (e.g., `file:///project/src/main.rs`) |
| `name` | string | Yes | Human-readable name |
| `description` | string | No | Optional description |
| `mimeType` | string | No | Content MIME type |
| `size` | number | No | Size in bytes |

### 4.3 Resource Operations

**Listing resources:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": { "cursor": "optional-cursor" }
}
```

**Reading a resource:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": { "uri": "file:///project/src/main.rs" }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "file:///project/src/main.rs",
        "mimeType": "text/x-rust",
        "text": "fn main() {\n    println!(\"Hello world!\");\n}"
      }
    ]
  }
}
```

### 4.4 Resource Templates

Server can expose **parameterized resources** using RFC 6570 URI templates:

```json
{
  "uriTemplate": "ticket://forgeos/{ticket_id}",
  "name": "Ticket Details",
  "description": "Access ticket data by ID",
  "mimeType": "application/json"
}
```

Arguments can be auto-completed through the completion API.

### 4.5 Subscriptions

Clients can subscribe to individual resource changes:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/subscribe",
  "params": { "uri": "ticket://forgeos/FORGEOS-RES001" }
}
```

Server sends update notifications:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/updated",
  "params": { "uri": "ticket://forgeos/FORGEOS-RES001" }
}
```

### 4.6 Resource Content Types

| Type | Format |
|------|--------|
| Text | `{ "uri": "...", "mimeType": "text/plain", "text": "content" }` |
| Binary | `{ "uri": "...", "mimeType": "image/png", "blob": "base64-data" }` |

### 4.7 Common URI Schemes

| Scheme | Purpose |
|--------|---------|
| `https://` | Web-accessible resources (client can fetch directly) |
| `file://` | Filesystem-like resources (not necessarily real FS) |
| `git://` | Git version control integration |
| Custom | Servers may define custom URI schemes |

### 4.8 Relevance to ForgeOS

**HIGH RELEVANCE.** ForgeOS could expose:
- **Ticket state** as resources (`ticket://forgeos/{id}`)
- **Agent output summaries** as resources (`summary://forgeos/{agent}/{ticket_id}`)
- **Memory bank entries** as subscribable resources
- **Dependency graphs** as dynamic resources

The resource subscription model aligns with ForgeOS's SSE-based event push (already implemented in `server.ts`). The current ForgeOS server does NOT yet use MCP resources — this is a gap that could provide significant value for agent context delivery.

---

## 5. Prompt Template Model

**Source:** [MCP Specification — Prompts](https://modelcontextprotocol.io/specification/2025-03-26/server/prompts) (weight: 1.0, official spec)

Prompts allow servers to provide **structured message templates** for interacting with language models. Prompts are **user-controlled** — exposed to end users for explicit selection (e.g., slash commands).

### 5.1 Capability Declaration

```json
{
  "capabilities": {
    "prompts": {
      "listChanged": true
    }
  }
}
```

### 5.2 Prompt Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier |
| `description` | string | No | Human-readable description |
| `arguments` | array | No | List of arguments for customization |

### 5.3 Prompt Operations

**Listing prompts:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "prompts/list"
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "prompts": [
      {
        "name": "code_review",
        "description": "Asks the LLM to analyze code quality and suggest improvements",
        "arguments": [
          {
            "name": "code",
            "description": "The code to review",
            "required": true
          }
        ]
      }
    ]
  }
}
```

**Getting a prompt (with arguments):**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompts/get",
  "params": {
    "name": "code_review",
    "arguments": {
      "code": "function hello() { console.log('world'); }"
    }
  }
}
```

Response returns an array of messages:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "description": "Code review prompt",
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Please review this code:\nfunction hello() { console.log('world'); }"
        }
      }
    ]
  }
}
```

### 5.4 Prompt Message Content Types

Prompt messages support the same content types as tool results:
- **Text** — plain text messages
- **Image** — base64-encoded images with MIME type
- **Audio** — base64-encoded audio with MIME type
- **Embedded Resources** — server-side resources referenced by URI

### 5.5 Relevance to ForgeOS

**MEDIUM RELEVANCE.** ForgeOS could use prompt templates for:
- Agent delegation packets (structured prompts for each agent role)
- Boot sequence instructions (templatized per agent type)
- Rework instructions (with ticket context injected)
- Code review prompts (for QA and Security agents)

However, the current ForgeOS architecture uses filesystem-based agent definitions (`.github/agents/*.agent.md`), which serve a similar purpose. Prompt templates would add protocol-level formalization but would require migrating the agent instruction system. This is a **nice-to-have** rather than critical for the initial ForgeOS distributed platform.

---

## 6. Session Lifecycle

**Source:** [MCP Specification — Lifecycle](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) (weight: 1.0, official spec)

MCP defines three lifecycle phases:

```
Initialization → Operation → Shutdown
```

### 6.1 Phase 1: Initialization

The initialization phase MUST be the first interaction. It establishes:
- Protocol version compatibility
- Capability negotiation
- Implementation identity exchange

**Step 1: Client sends `initialize` request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "roots": { "listChanged": true },
      "sampling": {}
    },
    "clientInfo": {
      "name": "ForgeOS-Agent",
      "version": "1.0.0"
    }
  }
}
```

**Step 2: Server responds with its capabilities**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "logging": {},
      "prompts": { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true },
      "tools": { "listChanged": true }
    },
    "serverInfo": {
      "name": "forgeos",
      "version": "1.0.0"
    },
    "instructions": "Optional instructions for the client"
  }
}
```

**Step 3: Client sends `initialized` notification**

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

### 6.2 Version Negotiation

- Client sends the protocol version it supports (SHOULD be the latest)
- If the server supports it, it responds with the same version
- If not, the server responds with a version it does support (SHOULD be its latest)
- If the client doesn't support the server's version, it SHOULD disconnect

### 6.3 Capability Negotiation

| Side | Capability | Description |
|------|-----------|-------------|
| Client | `roots` | Provides filesystem roots |
| Client | `sampling` | Supports LLM sampling requests |
| Client | `experimental` | Non-standard experimental features |
| Server | `prompts` | Offers prompt templates |
| Server | `resources` | Provides readable resources |
| Server | `tools` | Exposes callable tools |
| Server | `logging` | Emits structured log messages |
| Server | `completions` | Supports argument autocompletion |
| Server | `experimental` | Non-standard experimental features |

Sub-capabilities:
- `listChanged` — supports list change notifications (prompts, resources, tools)
- `subscribe` — supports subscribing to individual items (resources only)

### 6.4 Phase 2: Operation

During operation:
- Both parties respect negotiated protocol version
- Only negotiated capabilities are used
- Either side can send requests, responses, and notifications
- Cancellation, progress, and ping utilities are available

### 6.5 Phase 3: Shutdown

No specific shutdown messages are defined. Shutdown uses the transport mechanism:

**stdio:**
1. Client closes stdin to the server subprocess
2. Wait for server to exit, then SIGTERM
3. If still running, SIGKILL

**HTTP:**
- Close associated HTTP connections
- Client MAY send HTTP DELETE with `Mcp-Session-Id` to explicitly terminate

### 6.6 Timeouts

- Implementations SHOULD establish timeouts for all sent requests
- On timeout, sender SHOULD issue `notifications/cancelled` and stop waiting
- SDKs SHOULD allow per-request timeout configuration
- Progress notifications MAY reset the timeout clock
- A maximum timeout SHOULD always be enforced regardless of progress

### 6.7 Cancellation

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": {
    "requestId": "123",
    "reason": "User requested cancellation"
  }
}
```

**Rules:**
- The `initialize` request MUST NOT be cancelled by clients
- Receivers SHOULD stop processing and free resources
- Receivers MAY ignore if the request is unknown or already completed

### 6.8 ForgeOS Session Model

The current ForgeOS server operates in **stateless mode** (`sessionIdGenerator: undefined` in `server.ts`). Each HTTP request creates a new transport instance. This means:
- No persistent sessions between agent interactions
- Each tool call is independent
- State is managed by the PostgreSQL database, not the MCP session

This is a valid design choice for the ticket management use case, but limits the ability to use server-initiated requests to agents (e.g., pushing notifications). The SSE endpoint (`/events`) provides an out-of-band notification channel that compensates for this.

---

## 7. Transport Options

**Source:** [MCP Specification — Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) (weight: 1.0, official spec)

### 7.1 stdio

- Client launches MCP server as a **subprocess**
- Server reads JSON-RPC from **stdin**, writes to **stdout**
- Messages are **newline-delimited** (no embedded newlines)
- stderr may be used for logging
- Best for: local tools, development, IDE integrations
- Clients SHOULD support stdio whenever possible

### 7.2 Streamable HTTP (Current Standard)

Replaces the deprecated HTTP+SSE transport from protocol version 2024-11-05.

- Server provides a single HTTP endpoint (e.g., `/mcp`)
- Client sends requests via **HTTP POST**
- Server responds with either `application/json` or `text/event-stream` (SSE)
- Client MAY listen for server-initiated messages via **HTTP GET** (SSE stream)
- Sessions managed via `Mcp-Session-Id` header (optional)

**Key characteristics:**
- POST body: single JSON-RPC message, or batch array
- Accept header must include both `application/json` and `text/event-stream`
- Server can stream multiple messages back via SSE
- Supports resumability via SSE event IDs and `Last-Event-ID` header
- Session termination via HTTP DELETE

**Security requirements:**
- Servers MUST validate `Origin` header (prevent DNS rebinding)
- Local servers SHOULD bind to localhost only
- Servers SHOULD implement authentication

### 7.3 Custom Transports

Implementers MAY create custom transports. Requirements:
- Preserve JSON-RPC message format
- Maintain lifecycle requirements
- Document connection and exchange patterns

### 7.4 ForgeOS Transport (Codebase Evidence)

ForgeOS uses **Streamable HTTP** transport at the `/mcp` endpoint:

```typescript
// From forgeos-server/src/server.ts
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

The server also supports GET and DELETE on `/mcp` for SSE streaming and session termination. This follows the spec correctly.

---

## 8. Fitness Assessment for ForgeOS

### 8.1 Strengths (MCP → ForgeOS Alignment)

| Aspect | Assessment | Evidence |
|--------|-----------|----------|
| **Tool-centric design** | ★★★★★ | ForgeOS's 10 ticket operations map perfectly to MCP tools |
| **JSON-RPC foundation** | ★★★★★ | Standard, well-understood, excellent tooling ecosystem |
| **Capability negotiation** | ★★★★☆ | Allows incremental feature adoption per agent |
| **Input validation** | ★★★★★ | JSON Schema on tools + Zod in ForgeOS = double validation |
| **Error semantics** | ★★★★☆ | Protocol + application error distinction is clean |
| **Transport flexibility** | ★★★★☆ | Streamable HTTP suits distributed deployment |
| **SDK maturity** | ★★★★☆ | `@modelcontextprotocol/sdk` actively maintained, v1.27.1+ |
| **Pagination support** | ★★★★☆ | Cursor-based pagination on list operations |
| **Dynamic tool changes** | ★★★☆☆ | `listChanged` notifications allow runtime tool updates |

### 8.2 Limitations and Gaps

| Gap | Severity | Mitigation |
|-----|----------|------------|
| **No built-in multi-agent coordination** | Medium | ForgeOS handles this at the application layer (ticket state machine, lease system) |
| **No agent identity in protocol** | Medium | ForgeOS passes agent identity as tool parameters; could use `clientInfo` |
| **Stateless session model** | Low | ForgeOS uses DB for state; MCP sessions are optional |
| **No built-in workflow/saga support** | Medium | ForgeOS SDLC pipeline handles this via ticket stages |
| **Resource model unused** | Low | Opportunity to expose ticket/summary/graph data as resources |
| **Prompt model unused** | Low | Could formalize agent delegation as prompt templates |
| **No batch tool execution** | Medium | Each tool call is individual; ForgeOS could batch at the application layer |
| **No pub/sub for tool results** | Low | SSE endpoint provides equivalent functionality |

### 8.3 Adaptation Recommendations

1. **Implement MCP Resources** — Expose ticket state, agent summaries, dependency graphs, and memory bank as MCP resources with subscription support. This would give agents natural, protocol-level access to contextual data.

2. **Consider MCP Prompts** — Formalize agent delegation packets as prompt templates. This would standardize the agent instruction pipeline and make delegation inspectable via the protocol.

3. **Enable Stateful Sessions** — Consider enabling `sessionIdGenerator` for long-running agent sessions. This would allow server-initiated requests (e.g., pushing priority changes, lease expiry warnings) directly to connected agents.

4. **Add Tool Annotations** — Use tool annotations to declare side effects, idempotency, and destructive operations. This would allow clients to implement approval gates at the protocol level.

5. **Leverage Completion API** — Use MCP's argument completion for tool parameters (e.g., ticket IDs, stage names, agent names) to improve the agent developer experience.

---

## 9. Contradictions and Open Questions

### 9.1 Contradictions Found

| # | Contradiction | Classification | Resolution |
|---|--------------|---------------|------------|
| 1 | ForgeOS uses stateless transport but spec recommends sessions for server-initiated messages | Contextual | Stateless is valid for ForgeOS's request-response pattern; SSE `/events` endpoint handles push |
| 2 | Spec says tools are "model-controlled" but ForgeOS agents call tools programmatically | Contextual | MCP tools are designed to be invoked by LLMs, but the protocol supports any caller; ForgeOS agents ARE LLMs |
| 3 | Tool result content is always `[{type: 'text', text: string}]` in ForgeOS but spec supports multi-modal | Temporal | ForgeOS can add image/audio content types as needed; text-only is valid for ticket operations |

### 9.2 Open Questions

1. **Batch operations:** Should ForgeOS implement JSON-RPC batching for multi-tool agent operations (e.g., claim + update in one request)?
2. **Resource vs. tool overlap:** Some operations (reading ticket state) could be either a tool call or a resource read. Which model is better for each use case?
3. **Auth integration:** The MCP spec defines an authorization framework for HTTP. Should ForgeOS adopt it, or continue with the current API key approach?

---

## 10. Recommendations

### 10.1 Weighted Evaluation Matrix

| Criterion | Weight | MCP Score | Notes |
|-----------|--------|-----------|-------|
| Protocol fit for ticket ops | 0.25 | 9/10 | Tool model is perfect for CRUD + state transitions |
| SDK quality and maintenance | 0.15 | 8/10 | Active development, TypeScript-first, good docs |
| Transport suitability | 0.15 | 9/10 | Streamable HTTP + SSE covers all ForgeOS needs |
| Extensibility | 0.15 | 8/10 | Resources, prompts, custom transports allow growth |
| Community and adoption | 0.10 | 9/10 | Anthropic-backed, growing ecosystem, LF project |
| Security model | 0.10 | 7/10 | Basic but adequate; ForgeOS adds its own auth layer |
| Multi-agent support | 0.10 | 6/10 | Not built-in; adequate at application layer |
| **Weighted Total** | **1.00** | **8.2/10** | **RECOMMEND with high confidence** |

### 10.2 Primary Recommendation

**Continue with MCP as the communication protocol for ForgeOS agent-to-server interactions.**

- **Confidence:** 92% (HIGH)
- **Reasoning:** The protocol is already successfully implemented in `forgeos-server`. It maps cleanly to ticket operations. The SDK is mature and actively maintained. The growing ecosystem reduces lock-in risk.
- **Caveat:** Multi-agent coordination remains an application-layer concern. MCP provides the transport and tool invocation semantics, but ForgeOS must continue to manage workflow orchestration, agent lifecycle, and state consistency independently.

### 10.3 What Could Make This Wrong in 6 Months

1. A competing protocol gains critical mass and agent framework adoption (e.g., OpenAI standardizes a different protocol)
2. MCP spec makes breaking changes that invalidate existing tool registration patterns
3. The `@modelcontextprotocol/sdk` becomes unmaintained or diverges from the spec
4. ForgeOS requirements evolve to need real-time bidirectional streaming beyond what Streamable HTTP supports

---

## 11. Sources and Evidence Chain

| # | Source | Type | Weight | Recency | URL |
|---|--------|------|--------|---------|-----|
| 1 | MCP Specification — Overview | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/basic |
| 2 | MCP Specification — Lifecycle | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle |
| 3 | MCP Specification — Transports | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/basic/transports |
| 4 | MCP Specification — Tools | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/server/tools |
| 5 | MCP Specification — Resources | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/server/resources |
| 6 | MCP Specification — Prompts | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/server/prompts |
| 7 | MCP Specification — Cancellation | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/cancellation |
| 8 | ForgeOS Server Codebase | Primary source | 1.0 | 2026-03-05 | `forgeos-server/src/` |
| 9 | `@modelcontextprotocol/sdk` npm package | Official SDK | 0.9 | 2026 | https://www.npmjs.com/package/@modelcontextprotocol/sdk |
| 10 | JSON-RPC 2.0 Specification | Standard | 1.0 | 2013 (stable) | https://www.jsonrpc.org/specification |

**Validity Window:** This analysis is valid for 6 months (until 2026-09-05). Refresh triggers: new MCP spec revision, major SDK version bump, ForgeOS architecture changes.

---

*Report generated by Research Analyst agent for ticket FORGEOS-RES001.*
