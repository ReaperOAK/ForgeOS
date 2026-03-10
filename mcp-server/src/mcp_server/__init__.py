"""ForgeOS MCP Server — Multi-agent orchestration via Model Context Protocol.

This package provides the Python-based MCP server for the ForgeOS multi-agent
orchestration platform.  It exposes ticket lifecycle tools (claim, complete,
reject, release, etc.) over Streamable HTTP using the official MCP Python SDK.

Attributes
----------
__version__ : str
    Semantic version of the ForgeOS MCP server package.
__app_name__ : str
    Human-readable application name advertised during MCP ``initialize``.

.. meta::
   :last_reviewed: 2026-03-10T21:00:00Z
"""

__version__ = "0.1.0"
__app_name__ = "ForgeOS"
