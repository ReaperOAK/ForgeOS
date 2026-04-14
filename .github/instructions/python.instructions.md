---
name: Python Conventions
applyTo: '**/*.py'
description: Python-specific coding conventions for the ticket system and infrastructure scripts.
---

# Python Conventions

## 1. Style

RULE: Follow PEP 8 style guidelines.
RULE: Use 4-space indentation.
RULE: Maximum line length is 120 characters.
RULE: Use snake_case for functions and variables.
RULE: Use PascalCase for classes.
RULE: Use UPPER_SNAKE_CASE for constants.

## 2. Type Hints

RULE: All function signatures must include type hints.
RULE: Use `from __future__ import annotations` for forward references.
RULE: Use `Optional[T]` or `T | None` for nullable types.

## 3. Error Handling

RULE: Use specific exception types, never bare `except:`.
RULE: Log errors with structured output (JSON format preferred).
PROHIBITED: Silently swallowing exceptions.
PROHIBITED: Using `sys.exit()` without logging the reason.

## 4. Ticket System (tickets.py)

RULE: All ticket operations must be atomic — file writes use write-then-rename.
RULE: JSON files must be validated against schema before write.
RULE: Timestamps must be ISO 8601 format with timezone.
RULE: Lease expiry calculations use UTC.
RULE: CLI output must distinguish between human-readable and machine-readable (`--json`).

## 5. File Operations

RULE: Use `pathlib.Path` for all file path operations.
RULE: Use context managers (`with` statements) for file I/O.
RULE: Validate file existence before read operations.
PROHIBITED: Hardcoding absolute paths.

## 6. Security

PROHIBITED: Using `eval()` or `exec()` on untrusted input.
PROHIBITED: Shell injection via `os.system()` or `subprocess.run(shell=True)`.
RULE: Sanitize all CLI arguments before processing.
