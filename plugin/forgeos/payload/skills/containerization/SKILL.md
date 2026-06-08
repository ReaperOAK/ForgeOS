---
name: 'containerization'
description: 'Containerization and Docker best practices including multi-stage builds, security hardening, orchestration, and production deployment patterns.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['docker', 'containerization', 'kubernetes', 'devops']
  source: 'chunks/containerization-docker-best-practices.instructions'
  last-updated: '2026-02-26'
---

## Overview

Containerization and Docker best practices including multi-stage builds, security hardening, orchestration, and production deployment patterns.


# Containerization & Docker

## When to Use
- Creating Dockerfiles for applications
- Optimizing container images
- Implementing multi-stage builds
- Configuring container orchestration

## Key Practices
1. **Multi-Stage Builds** — Separate build and runtime stages for smaller images
2. **Security Hardening** — Non-root users, minimal base images, vulnerability scanning
3. **Layer Optimization** — Order instructions for maximum cache efficiency
4. **Orchestration** — Kubernetes, Docker Compose for production deployments

## Resources
See the `references/` directory for:
- Dockerfile best practices
- Multi-stage build patterns
- Security hardening checklist

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
