"""Allow running the package as ``python -m mcp_server``.

This module is the entry-point shim that delegates to
:func:`mcp_server.server.main`.  It enables invocation via::

    python -m mcp_server

.. meta::
   :last_reviewed: 2026-03-10T21:00:00Z
"""

from mcp_server.server import main

if __name__ == "__main__":
    main()
