## TODO-DOCK001: Full Dockerization and compose-based deployment for ForgeOS MCP

**ticket_id**: TODO-DOCK001
**title**: Full Dockerization of ForgeOS MCP and supporting services (Postgres, PgBouncer, optional local services)
**type**: infra
**priority**: P0
**estimated_effort**: L
**file_paths**: Dockerfile, docker-compose.yml, infra/docker/forgeos/Dockerfile, infra/docker/compose/*.yml, forgeos-server/Dockerfile, infra/README-docker.md
**depends_on**: TODO-INS001, TASK-COP-MCP006, TASK-COP-MCP004

### Description

Create production-capable container images, development compose stacks, and orchestration artifacts for ForgeOS MCP, its database, and supporting services. Provide image build scripts, CI pipeline snippets (GitHub Actions), and docs for deploying locally and to a container registry.

### Acceptance Criteria
- Given the repo root, when `docker build -t forgeos/mcp:dev -f forgeos-server/Dockerfile .` completes, then image builds successfully and starts with `docker run` to a healthy listening port.
- Given `docker-compose -f infra/docker/compose/dev.yml up --build`, when started, then the MCP service, Postgres, and PgBouncer reach healthy state and `curl http://localhost:3010/ready` returns `200`.
- Given CI, when a push to `main` occurs, then a workflow builds and optionally publishes images with appropriate tags and SLSA provenance (docs/snippet included).
- Provide minimal Kubernetes manifest examples for production deployment (manifest templates under `infra/k8s/`), but not full k8s operator implementation.

### Implementation Notes
- Use small base images and multi-stage builds to minimize size.
- Provide a `make docker-build` and `make docker-up-dev` targets in Makefile.
- Mark secrets and credentials to be provided via environment or secret managers; do not commit them.
