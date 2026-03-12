"""Pydantic models for ForgeOS ticket operations.

Defines :class:`Ticket`, :class:`Claim`, :class:`Evidence`,
:class:`OperationResult`, :class:`ListResponse`, and
:class:`DelegationPayload` — the data types returned by
:class:`~forgeos_sdk.operations.TicketOperations`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Ticket(BaseModel):
    """A ForgeOS ticket as returned by the MCP server.

    Attributes:
        ticket_id: Human-readable ticket identifier (e.g. ``FORGEOS-BE003``).
        title: Short description of the ticket.
        type: Ticket type (``backend``, ``frontend``, ``fullstack``, etc.).
        priority: Priority level (``critical``, ``high``, ``medium``, ``low``).
        status: Operational status (``READY``, ``CLAIMED``, ``DONE``, etc.).
        stage: Current SDLC stage.
        claimed_by: UUID of the agent holding the claim, if any.
        claimed_by_name: Human-readable name of the claiming agent.
        machine_id: Hostname of the machine running the claiming agent.
        operator: Human operator who initiated the claim.
        lease_expiry: When the claim lease expires.
        file_paths: Workspace-relative paths in the ticket's scope.
        acceptance_criteria: List of acceptance criteria strings.
        depends_on: Ticket IDs this ticket depends on.
        rework_count: Number of times this ticket has been reworked.
    """

    ticket_id: str
    title: str = ""
    type: str = ""
    priority: str = ""
    status: str = ""
    stage: str = ""
    claimed_by: str | None = None
    claimed_by_name: str | None = None
    machine_id: str | None = None
    operator: str | None = None
    lease_expiry: datetime | None = None
    file_paths: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    rework_count: int = 0

    model_config = {"extra": "allow"}


class Evidence(BaseModel):
    """Structured evidence for ticket stage completion.

    Attributes:
        artifacts: Workspace-relative paths of files created or modified.
        test_results: Summary of test results, or ``'N/A'`` with justification.
        confidence: Agent's self-assessed confidence (``HIGH``, ``MEDIUM``, ``LOW``).
        notes: Optional free-text notes about the work performed.
    """

    artifacts: list[str] = Field(min_length=1)
    test_results: str = Field(min_length=1)
    confidence: str = Field(pattern=r"^(HIGH|MEDIUM|LOW)$")
    notes: str | None = None


class Claim(BaseModel):
    """Result of a ticket claim operation.

    Attributes:
        ticket: The claimed ticket with updated status.
        lease_expiry: When the claim lease expires.
        file_locks: Workspace-relative file paths locked for this ticket.
    """

    ticket: Ticket
    lease_expiry: datetime
    file_locks: list[str] = Field(default_factory=list)


class OperationResult(BaseModel):
    """Generic result for operations that return a confirmation.

    Attributes:
        success: Whether the operation succeeded.
        message: Human-readable status message.
        ticket: The ticket affected by the operation, if applicable.
        data: Additional structured data from the server response.
    """

    success: bool
    message: str = ""
    ticket: Ticket | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class ListResponse(BaseModel):
    """Paginated list of tickets returned by ``tickets.list``.

    Attributes:
        tickets: List of tickets matching the query filters.
        total: Total number of tickets matching the query (before pagination).
        limit: Maximum number of tickets returned per page.
        offset: Zero-based offset into the full result set.
    """

    tickets: list[Ticket] = Field(default_factory=list)
    total: int = 0
    limit: int = 50
    offset: int = 0

    model_config = {"extra": "allow"}


class DelegationPayload(BaseModel):
    """Delegation context returned by ``tickets.payload``.

    Contains the full ticket, upstream summary from the previous stage
    agent, relevant memory entries, and the authorized file scope.

    Attributes:
        ticket: The ticket with full detail.
        upstream_summary: Markdown summary from the previous stage agent.
        memory_entries: Relevant memory entries for the ticket.
        file_scope: Workspace-relative paths the agent is authorized to
            read and write.
    """

    ticket: Ticket
    upstream_summary: str = ""
    memory_entries: list[dict[str, Any]] = Field(default_factory=list)
    file_scope: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


# ------------------------------------------------------------------
# Code graph models
# ------------------------------------------------------------------


class AffectedSymbol(BaseModel):
    """A symbol affected by a change in the blast radius analysis.

    Attributes:
        name: Fully qualified symbol name.
        kind: Symbol kind (function, class, method, variable, etc.).
        file_path: Workspace-relative file path containing the symbol.
        line: Line number where the symbol is defined.
        depth: Distance from the origin file in the dependency graph.
    """

    name: str
    kind: str = ""
    file_path: str = ""
    line: int | None = None
    depth: int = 0

    model_config = {"extra": "allow"}


class BlastRadiusResult(BaseModel):
    """Result of a ``code.blast_radius`` analysis.

    Returns the set of symbols and files that would be affected
    by a change to the specified file.

    Attributes:
        file_path: The origin file analysed.
        affected_files: Workspace-relative paths of affected files.
        affected_symbols: Symbols transitively affected by a change.
        total_affected: Total number of affected symbols.
    """

    file_path: str
    affected_files: list[str] = Field(default_factory=list)
    affected_symbols: list[AffectedSymbol] = Field(default_factory=list)
    total_affected: int = 0

    model_config = {"extra": "allow"}


class SymbolMatch(BaseModel):
    """A single symbol match from ``code.search_symbols``.

    Attributes:
        name: Fully qualified symbol name.
        kind: Symbol kind (function, class, method, variable, etc.).
        file_path: Workspace-relative file path containing the symbol.
        line: Line number where the symbol is defined.
        signature: Function/method signature if applicable.
    """

    name: str
    kind: str = ""
    file_path: str = ""
    line: int | None = None
    signature: str = ""

    model_config = {"extra": "allow"}


class SymbolSearchResult(BaseModel):
    """Result of a ``code.search_symbols`` query.

    Attributes:
        pattern: The name pattern used for the search.
        matches: List of symbols matching the pattern.
        total: Total number of matches found.
    """

    pattern: str = ""
    matches: list[SymbolMatch] = Field(default_factory=list)
    total: int = 0

    model_config = {"extra": "allow"}


class ImportEntry(BaseModel):
    """A single import relationship from ``code.get_imports``.

    Attributes:
        source: The file or module that imports.
        target: The file or module being imported.
        symbols: Specific symbols imported (empty if importing the module).
        depth: Depth in the import chain from the origin file.
    """

    source: str
    target: str
    symbols: list[str] = Field(default_factory=list)
    depth: int = 0

    model_config = {"extra": "allow"}


class ImportChainResult(BaseModel):
    """Result of a ``code.get_imports`` traversal.

    Attributes:
        file_path: The origin file analysed.
        imports: List of import relationships in the chain.
        total: Total number of import edges found.
    """

    file_path: str
    imports: list[ImportEntry] = Field(default_factory=list)
    total: int = 0

    model_config = {"extra": "allow"}


# ------------------------------------------------------------------
# Init tool models
# ------------------------------------------------------------------


class IndexResult(BaseModel):
    """Result of an ``init.index`` codebase indexing operation.

    Attributes:
        total_files: Total number of files discovered.
        indexed: Number of files successfully indexed.
        skipped: Number of files skipped (binary, too large, etc.).
        symbols_found: Total symbols extracted across all indexed files.
        imports_found: Total import relationships extracted.
    """

    total_files: int = 0
    indexed: int = 0
    skipped: int = 0
    symbols_found: int = 0
    imports_found: int = 0

    model_config = {"extra": "allow"}


class OrientationResult(BaseModel):
    """Result of an ``init.orient`` project orientation scan.

    Attributes:
        project_name: Detected project name.
        package_manager: Detected package manager (npm, pip, cargo, etc.).
        frameworks: List of detected frameworks (e.g. ``["express", "react"]``).
        languages: List of detected languages (e.g. ``["typescript", "python"]``).
        entry_points: Detected entry point files.
        test_framework: Detected test framework (vitest, pytest, jest, etc.).
        build_system: Detected build system (webpack, vite, make, etc.).
    """

    project_name: str = ""
    package_manager: str = ""
    frameworks: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    entry_points: list[str] = Field(default_factory=list)
    test_framework: str = ""
    build_system: str = ""

    model_config = {"extra": "allow"}


# ------------------------------------------------------------------
# Memory tool models
# ------------------------------------------------------------------

LessonCategory = Literal[
    "bug_fix",
    "pattern",
    "architecture",
    "performance",
    "security",
    "testing",
    "refactor",
    "tooling",
]


class MemorySearchLessonsInput(BaseModel):
    """Input parameters for ``memory.search_lessons``.

    Attributes:
        query: Free-text search query for lesson content.
        category: Optional category filter.
        max_results: Maximum number of lessons to return (default 10).
    """

    query: str = Field(min_length=1)
    category: LessonCategory | None = None
    max_results: int | None = None


class MemoryAddLessonInput(BaseModel):
    """Input parameters for ``memory.add_lesson``.

    Attributes:
        ticket_id: The ticket that produced this lesson.
        title: Short title for the lesson.
        content: Full lesson content / description.
        category: Lesson category (must be one of the allowed literals).
    """

    ticket_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    category: LessonCategory


class MemoryGetContextInput(BaseModel):
    """Input parameters for ``memory.get_context``.

    Attributes:
        file_path: Optional workspace-relative file path to scope context.
        ticket_id: Optional ticket ID to scope context.
        max_lessons: Maximum number of relevant lessons to include.
    """

    file_path: str | None = None
    ticket_id: str | None = None
    max_lessons: int | None = None


class Lesson(BaseModel):
    """A single lesson returned from the memory system.

    Attributes:
        id: Unique lesson identifier.
        title: Short title.
        content: Full lesson content.
        category: Lesson category.
        confidence: Confidence score (0.0–1.0).
        similarity_score: Relevance score from search (0.0–1.0).
    """

    id: str
    title: str = ""
    content: str = ""
    category: str = ""
    confidence: float = 0.0
    similarity_score: float = 0.0

    model_config = {"extra": "allow"}


class ContextResponse(BaseModel):
    """Result of a ``memory.get_context`` query.

    Attributes:
        blast_radius: List of workspace-relative file paths in the
            blast radius of the queried file or ticket.
        relevant_lessons: Lessons relevant to the queried context.
        context_score: Overall relevance score for the context (0.0–1.0).
    """

    blast_radius: list[str] = Field(default_factory=list)
    relevant_lessons: list[Lesson] = Field(default_factory=list)
    context_score: float = 0.0

    model_config = {"extra": "allow"}
