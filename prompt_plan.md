GOAL

Upgrade ForgeOS from a context-discovery execution model into a deterministic execution packet architecture.

In the current architecture, agents must reconstruct context by exploring the repository, searching files, and inferring system history.

This produces token waste, nondeterministic execution, and inconsistent results across agents.

This phase introduces the Prompt Compiler system.

The Prompt Compiler transforms tickets into fully synthesized execution packets before agents claim them.

Execution packets contain:

• complete ticket specification
• relevant code context
• historical work attempts
• lessons learned from memory
• architecture constraints
• deterministic execution plan

Agents must no longer perform repository discovery.

Agents must receive a fully prepared execution packet.

This enables stateless IDE agents and eliminates repository exploration overhead.

Ticketer remains the orchestrator and must coordinate this upgrade strictly through the SDLC pipeline.


--------------------------------------------------

CORE PRINCIPLES

ForgeOS must operate according to the following principles.

Deterministic execution  
Agents must execute precompiled execution packets.

Centralized intelligence  
All context gathering occurs inside ForgeOS infrastructure.

Stateless execution agents  
Executor agents must not reconstruct context.

Zero discovery overhead  
Agents must not crawl the repository.

Prompt determinism  
Execution packets must be reproducible.

Prompt freshness  
Execution packets must always reflect the current repository state.

Portable IDE integration  
Any IDE agent must execute tickets without repository configuration.


--------------------------------------------------

SYSTEM COMPONENTS

The Prompt Compiler architecture introduces a new subsystem.


PROMPT COMPILER (EXECUTION PACKET GENERATOR)

The Prompt Compiler synthesizes execution prompts for tickets.

It integrates with:

Ticket MCP
Cognition Engine
Memory Engine
Code Graph tools

The compiler must:

1 retrieve ticket specification
2 reconstruct historical attempts
3 retrieve code context
4 retrieve engineering knowledge
5 generate deterministic execution prompt

The compiled execution packet must be stored in PostgreSQL.


--------------------------------------------------

EXECUTION PACKET STRUCTURE

Execution packets must follow this strict schema.

ROLE

Executor persona appropriate for the ticket.

TICKET

Title
Ticket ID
Priority
Goal
Acceptance Criteria


SYSTEM CONSTRAINTS

Rules the executor must obey:

• respect declared file_paths
• do not modify files outside scope
• follow architecture boundaries
• run required validation checks
• commit changes using ForgeOS conventions


HISTORY

Previous attempts to resolve the ticket.

Include:

• agents involved
• files modified
• outcomes
• unresolved issues


LEARNINGS

Relevant procedural memory retrieved from the Memory Engine.

These represent lessons learned from past failures or fixes.


BEST PRACTICES

Relevant codebase conventions.

Include:

• architecture constraints
• security requirements
• performance expectations
• testing standards


CONTEXT LOCATIONS

Files the executor must read before making modifications.

Each entry must include:

file path
reason it is relevant


YOUR EXACT TASK

Precise description of the required implementation.


EXECUTION PLAN

Deterministic step-by-step execution instructions.


EDGE CASES

Failure scenarios that must be handled.


POST-COMPLETION

After completing work the executor must:

• store learnings in memory
• run tests and linters
• update ticket state via MCP
• attach artifacts and commit references


--------------------------------------------------

PHASE 1 — PROMPT COMPILER SERVICE

Implement the Prompt Compiler service inside ForgeOS.

Responsibilities:

fetch ticket data
query memory
query cognition graph
synthesize execution packet

The compiler must use a lightweight LLM suitable for rapid synthesis.

Recommended models include:

Gemini Flash
similar low-cost models with tool usage capability

The compiler must operate through an agentic tool loop:

retrieve ticket
retrieve memory
retrieve code graph context
synthesize execution packet

The compiler must never execute code.


--------------------------------------------------

PHASE 2 — EXECUTION PACKET STORAGE

Extend the ticket schema.

Add fields:

compiled_prompt
compiled_at
context_hash


compiled_prompt

Stores the execution packet.


compiled_at

Timestamp of compilation.


context_hash

Hash representing the environment used during compilation.

The hash must include:

repository commit
cognition graph version
memory snapshot version


--------------------------------------------------

PHASE 3 — PROMPT FRESHNESS VALIDATION

Execution packets must never be trusted blindly.

Before delivering a compiled prompt to an executor agent:

Ticketer must verify prompt freshness.

Validation logic:

if context_hash == current_context_hash  
    prompt is valid

else  
    prompt must be recompiled


This prevents prompt drift when:

• repository changes
• cognition graph updates
• memory evolves


--------------------------------------------------

PHASE 4 — BACKGROUND COMPILATION

Execution packets should be generated asynchronously.

When a ticket transitions into an executable state:

READY
TODO
BACKEND
FRONTEND

Ticketer must trigger background prompt compilation.

This ensures executor agents never wait for compilation.


--------------------------------------------------

PHASE 5 — IDE DELIVERY MODEL

Modify the ticket claim mechanism.

When an executor agent claims a ticket:

the system must return:

ticket_id
compiled_prompt
raw_payload


compiled_prompt becomes the system directive for the executor agent.

Executor agents must treat this prompt as authoritative instructions.


--------------------------------------------------

PHASE 6 — MEMORY INJECTION

Before compiling prompts, the compiler must query the Memory Engine.

Memory retrieval must consider:

ticket domain
affected modules
similar historical tickets

Relevant memory entries must populate:

LEARNINGS
BEST PRACTICES


--------------------------------------------------

PHASE 7 — COGNITION INJECTION

The compiler must query the Cognition Engine.

Relevant tools include:

mcp_get_blast_radius
mcp_search_code
mcp_get_dependencies
mcp_get_module_structure

Results populate:

CONTEXT LOCATIONS
EXECUTION PLAN


Agents must never perform repository exploration themselves.


--------------------------------------------------

PHASE 8 — REPOSITORY DECOUPLING

The Prompt Compiler enables ForgeOS to decouple execution intelligence from repository markdown files.

Agent definitions currently stored in:

.github/agents/
.github/vibecoding/

may be migrated into the centralized memory system.

However:

core governance rules stored in

.github/instructions/

must remain version controlled.


--------------------------------------------------

AGENT INTERACTION RULES

Executor agents must treat execution packets as authoritative.

Agents must not:

perform repository-wide search
guess architecture
scan unrelated files

Agents may only use:

execution packet
MCP tools
explicit cognition queries


--------------------------------------------------

TICKETER SUPERVISION

Ticketer must supervise the Prompt Compiler.

Responsibilities:

ensure compilation jobs succeed
validate execution packet freshness
recompile stale prompts
monitor prompt success metrics

Ticketer must remain the orchestrator and must not generate prompts itself.


--------------------------------------------------

SUCCESS CRITERIA

ForgeOS must demonstrate the following capabilities.

Agents receive deterministic execution packets.

Agents no longer perform repository exploration.

Execution packets include:

relevant code context
historical attempts
procedural memory
deterministic execution plan

Prompt freshness validation prevents stale instructions.

IDE agents can connect to ForgeOS with zero repository configuration.


--------------------------------------------------

EXECUTION

Ticketer must orchestrate this upgrade strictly through the SDLC pipeline.

Implementation must proceed through Research, Architect, Backend, QA, and Validator stages.

All modifications must occur through ticket execution.

Direct system modifications outside the ticket lifecycle are forbidden.

Begin orchestration.