<!-- last_reviewed: 2026-03-10T15:00:00Z -->
<!-- audience: developer, operator -->
<!-- diataxis: reference -->

# ForgeOS — Backup Strategy
<!-- Ticket: FORGEOS-DO007 -->

## Overview

This document describes the backup and restore strategy for the ForgeOS
PostgreSQL database. It covers backup frequency, retention policy, WAL
archiving guidance, and disaster recovery procedures.

## 1. Backup Tooling

| Tool | Location | Purpose |
|------|----------|---------|
| `infra/scripts/backup.sh` | Backup script | Automated pg_dump with compression, checksums, rotation |
| `infra/scripts/restore.sh` | Restore script | Validated restore with integrity checks and confirmation |
| `Makefile` (infra/) | Make targets | `make backup`, `make restore FILE=<path>` |

Both scripts support **Docker Compose** local instances (`--docker`) and
**remote PostgreSQL** servers (via `PGHOST`/`PGPORT` environment variables).

## 2. Backup Formats

| Format | Extension | Tool | Use Case |
|--------|-----------|------|----------|
| Custom | `.dump` | pg_dump `--format=custom` | **Recommended.** Supports selective restore, parallel restore, compression. |
| SQL | `.sql.gz` | pg_dump `--format=plain` + gzip | Portable plain-text. Useful for inspection, version control, or cross-version migration. |

**Default:** Custom format with compression level 6.

## 3. Frequency Schedule

### Development

| Schedule | Type | Retention |
|----------|------|-----------|
| On demand | Full dump | 3 days |

Developers run `make backup` before destructive schema changes.

### Staging

| Schedule | Type | Retention |
|----------|------|-----------|
| Daily (02:00 UTC) | Full dump | 7 days |

Automated via cron or CI scheduled workflow.

### Production

| Schedule | Type | Retention |
|----------|------|-----------|
| Every 6 hours | Full dump | 7 days (short-term) |
| Daily (03:00 UTC) | Full dump | 30 days (long-term) |
| Weekly (Sunday 04:00 UTC) | Full dump | 90 days (archive) |
| Continuous | WAL archiving | 7 days |

## 4. Retention Policy

```
Environment    Full Backup Retention    WAL Retention
-----------    --------------------    -------------
development    3 days                  N/A
staging        7 days                  N/A
production     7d (frequent) +         7 days
               30d (daily) +
               90d (weekly archive)
```

The `backup.sh` script enforces retention via the `--retention` flag, which
deletes backup files older than the specified number of days. The default
retention period is **7 days**.

### Storage Estimates

Assuming a 500 MB database with custom-format compression (~60% ratio):

| Tier | Frequency | Retention | Approx. Storage |
|------|-----------|-----------|-----------------|
| Short-term | 4/day | 7 days | 28 × 200 MB ≈ 5.5 GB |
| Daily | 1/day | 30 days | 30 × 200 MB ≈ 6 GB |
| Weekly | 1/week | 90 days | 13 × 200 MB ≈ 2.6 GB |
| **Total** | | | **~14 GB** |

## 5. WAL Archiving (Production)

Write-Ahead Log (WAL) archiving enables **point-in-time recovery (PITR)** — the
ability to recover the database to any moment between full backups.

### Configuration

Add to `postgresql.conf` (or Docker environment/command):

```ini
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
archive_timeout = 300   # Force archive every 5 minutes even if WAL not full
```

### Point-in-Time Recovery Steps

1. Stop PostgreSQL.
2. Restore the most recent base backup (full dump).
3. Copy archived WAL files into `pg_wal/`.
4. Create `recovery.signal` file in the data directory.
5. Set `restore_command` in `postgresql.conf`:
   ```ini
   restore_command = 'cp /var/lib/postgresql/wal_archive/%f %p'
   recovery_target_time = '2026-03-07 14:30:00 UTC'
   ```
6. Start PostgreSQL — it replays WAL up to the target time.
7. Run `SELECT pg_wal_replay_resume();` after verification.

### Docker Compose WAL Setup

For the ForgeOS Docker setup, add to the postgres service command:

```yaml
postgres:
  command:
    - "postgres"
    - "-c" 
    - "wal_level=replica"
    - "-c"
    - "archive_mode=on"
    - "-c"
    - "archive_command=cp %p /var/lib/postgresql/wal_archive/%f"
    - "-c"
    - "archive_timeout=300"
  volumes:
    - pgdata:/var/lib/postgresql/data
    - wal-archive:/var/lib/postgresql/wal_archive
```

> **Note:** WAL archiving is recommended for production only. Development and
> staging environments rely on periodic full dumps.

## 6. Integrity Verification

Every backup includes:

1. **SHA-256 checksum** — stored in a `.meta` sidecar file alongside the backup.
2. **pg_restore --list** (custom format) — validates the dump TOC is parseable.
3. **gzip -t** (SQL format) — validates compression integrity.

The restore script automatically verifies checksums and format integrity
before applying any restore operation.

### Periodic Verification (Production)

Schedule a weekly job that runs `restore.sh --dry-run` on the latest backup
to confirm the backup can be parsed without errors. Example cron:

```bash
# Weekly backup verification — Sunday 06:00 UTC
0 6 * * 0 /path/to/infra/scripts/restore.sh /path/to/latest.dump --dry-run --docker 2>&1 | logger -t forgeos-backup-verify
```

## 7. Disaster Recovery Runbook

### Scenario 1: Corrupted Database (Development)

1. Stop the application: `docker compose down`
2. List backups: `make restore-list`
3. Restore: `make restore FILE=infra/backups/forgeos_20260307T120000Z.dump`
4. Restart: `docker compose up -d`

### Scenario 2: Full Recovery (Production)

1. **Assess:** Determine failure scope (data corruption vs. host failure).
2. **Notify:** Alert the team via incident channel.
3. **Restore base backup:**
   ```bash
   ./infra/scripts/restore.sh /backup/forgeos_latest.dump --docker --yes
   ```
4. **Apply WAL for PITR** (if needed — see Section 5).
5. **Verify:** Check table counts, run smoke tests.
6. **Resume:** Bring application back online.
7. **Post-mortem:** Document root cause within 48 hours.

### RTO / RPO Targets

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | ≤ 5 minutes | With WAL archiving (production) |
| **RPO** (without WAL) | ≤ 6 hours | Full dump interval |
| **RTO** (Recovery Time Objective) | ≤ 30 minutes | For databases < 10 GB |

## 8. Cron Examples

### Staging — Daily Backup

```bash
# /etc/cron.d/forgeos-backup-staging
0 2 * * * forgeos cd /opt/forgeos && ./infra/scripts/backup.sh --docker --verify --retention 7 2>&1 | logger -t forgeos-backup
```

### Production — Every 6 Hours

```bash
# /etc/cron.d/forgeos-backup-prod
0 */6 * * * forgeos cd /opt/forgeos && ./infra/scripts/backup.sh --docker --verify --retention 7 2>&1 | logger -t forgeos-backup-frequent
```

### Production — Daily Archive (30-day retention)

```bash
0 3 * * * forgeos cd /opt/forgeos && BACKUP_DIR=/backup/daily ./infra/scripts/backup.sh --docker --verify --retention 30 2>&1 | logger -t forgeos-backup-daily
```

### Production — Weekly Archive (90-day retention)

```bash
0 4 * * 0 forgeos cd /opt/forgeos && BACKUP_DIR=/backup/weekly ./infra/scripts/backup.sh --docker --verify --retention 90 2>&1 | logger -t forgeos-backup-weekly
```

## 9. Security Considerations

- Backup files contain **all database data** including potentially sensitive
  information. Store them with restricted permissions (`chmod 600`).
- Never commit backup files to version control. The `infra/backups/` directory
  is `.gitignore`d.
- In production, encrypt backups at rest (GPG or filesystem-level encryption).
- Transfer backups over encrypted channels only (SSH/SCP, TLS).
- Rotate backup storage credentials on the same schedule as database credentials.

## 10. Monitoring & Alerts

| Check | Threshold | Action |
|-------|-----------|--------|
| Backup age | > 24h (staging), > 7h (production) | Alert on-call |
| Backup file size | Sudden drop > 50% | Investigate — may indicate partial dump |
| Verification failure | Any | Page on-call |
| Disk usage (backup volume) | > 80% | Expand or adjust retention |
