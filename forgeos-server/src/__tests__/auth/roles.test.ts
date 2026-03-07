/**
 * Unit tests for auth/roles module.
 *
 * Validates the role-based permission matrix, stage ownership checks,
 * wildcard (admin) permission handling, and role validation functions.
 *
 * @module __tests__/auth/roles.test
 * @ticket TASK-FOS-04-001
 */

import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  isValidRole,
  getPermissionsForRole,
  canOperateInStage,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  STAGE_OWNERSHIP,
  AGENT_ROLES,
} from '../../auth/roles.js';

// ── hasPermission ────────────────────────────────────────────────────────────

describe('hasPermission', () => {
  it('returns true when permission is in the granted list', () => {
    const granted = [PERMISSIONS.TICKETS_CLAIM, PERMISSIONS.TICKETS_ADVANCE];
    expect(hasPermission(granted, PERMISSIONS.TICKETS_CLAIM)).toBe(true);
  });

  it('returns false when permission is not in the granted list', () => {
    const granted = [PERMISSIONS.TICKETS_NEXT];
    expect(hasPermission(granted, PERMISSIONS.TICKETS_CLAIM)).toBe(false);
  });

  it('returns true for wildcard permission regardless of requested permission', () => {
    const granted = ['*'];
    expect(hasPermission(granted, PERMISSIONS.TICKETS_CLAIM)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.ADMIN_FORCE_RELEASE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.ADMIN_MANAGE_KEYS)).toBe(true);
  });

  it('returns false for empty permission list', () => {
    expect(hasPermission([], PERMISSIONS.TICKETS_CLAIM)).toBe(false);
  });

  it('returns true for exact match with a non-standard permission string', () => {
    expect(hasPermission(['custom.permission'], 'custom.permission')).toBe(true);
  });
});

// ── isValidRole ──────────────────────────────────────────────────────────────

describe('isValidRole', () => {
  it('returns true for all defined agent roles', () => {
    for (const role of AGENT_ROLES) {
      expect(isValidRole(role)).toBe(true);
    }
  });

  it('returns false for unknown role strings', () => {
    expect(isValidRole('superadmin')).toBe(false);
    expect(isValidRole('root')).toBe(false);
    expect(isValidRole('')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isValidRole('Admin')).toBe(false);
    expect(isValidRole('BACKEND')).toBe(false);
  });
});

// ── getPermissionsForRole ────────────────────────────────────────────────────

describe('getPermissionsForRole', () => {
  it('returns wildcard for admin role', () => {
    const perms = getPermissionsForRole('admin');
    expect(perms).toContain('*');
  });

  it('returns expected permissions for backend role', () => {
    const perms = getPermissionsForRole('backend');
    expect(perms).toContain(PERMISSIONS.TICKETS_CLAIM);
    expect(perms).toContain(PERMISSIONS.TICKETS_ADVANCE);
    expect(perms).toContain(PERMISSIONS.TICKETS_NEXT);
    expect(perms).not.toContain(PERMISSIONS.TICKETS_REJECT);
    expect(perms).not.toContain(PERMISSIONS.ADMIN_FORCE_RELEASE);
  });

  it('includes reject permission for QA, security, ci_reviewer, and validator roles', () => {
    const reviewRoles = ['qa', 'security', 'ci_reviewer', 'validator'];
    for (const role of reviewRoles) {
      const perms = getPermissionsForRole(role);
      expect(perms).toContain(PERMISSIONS.TICKETS_REJECT);
    }
  });

  it('returns empty array for unknown role', () => {
    expect(getPermissionsForRole('unknown_role')).toEqual([]);
  });

  it('does not include reject for implementation roles', () => {
    const implRoles = ['backend', 'frontend', 'architect', 'research', 'documentation'];
    for (const role of implRoles) {
      const perms = getPermissionsForRole(role);
      expect(perms).not.toContain(PERMISSIONS.TICKETS_REJECT);
    }
  });
});

// ── canOperateInStage ────────────────────────────────────────────────────────

describe('canOperateInStage', () => {
  it('backend can operate in BACKEND stage', () => {
    expect(canOperateInStage('backend', 'BACKEND')).toBe(true);
  });

  it('backend cannot operate in QA stage', () => {
    expect(canOperateInStage('backend', 'QA')).toBe(false);
  });

  it('admin can operate in any stage', () => {
    expect(canOperateInStage('admin', 'BACKEND')).toBe(true);
    expect(canOperateInStage('admin', 'QA')).toBe(true);
    expect(canOperateInStage('admin', 'SECURITY')).toBe(true);
    expect(canOperateInStage('admin', 'DOCUMENTATION')).toBe(true);
  });

  it('qa can operate in QA stage', () => {
    expect(canOperateInStage('qa', 'QA')).toBe(true);
  });

  it('qa cannot operate in BACKEND stage', () => {
    expect(canOperateInStage('qa', 'BACKEND')).toBe(false);
  });

  it('devops can operate in BACKEND stage', () => {
    expect(canOperateInStage('devops', 'BACKEND')).toBe(true);
  });

  it('returns false for unknown role', () => {
    expect(canOperateInStage('nonexistent', 'BACKEND')).toBe(false);
  });

  it('each role has correct stage ownership', () => {
    for (const role of AGENT_ROLES) {
      if (role === 'admin') continue;
      const stages = STAGE_OWNERSHIP[role];
      for (const stage of stages) {
        expect(canOperateInStage(role, stage)).toBe(true);
      }
    }
  });
});

// ── ROLE_PERMISSIONS completeness ────────────────────────────────────────────

describe('ROLE_PERMISSIONS', () => {
  it('every agent role has an entry in ROLE_PERMISSIONS', () => {
    for (const role of AGENT_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('admin has exactly the wildcard permission', () => {
    expect(ROLE_PERMISSIONS.admin).toEqual(['*']);
  });

  it('todo role can only view graph, stats, and spawn', () => {
    expect(ROLE_PERMISSIONS.todo).toContain(PERMISSIONS.TICKETS_GRAPH);
    expect(ROLE_PERMISSIONS.todo).toContain(PERMISSIONS.TICKETS_STATS);
    expect(ROLE_PERMISSIONS.todo).toContain(PERMISSIONS.TICKETS_SPAWN);
    expect(ROLE_PERMISSIONS.todo).not.toContain(PERMISSIONS.TICKETS_CLAIM);
    expect(ROLE_PERMISSIONS.todo).not.toContain(PERMISSIONS.TICKETS_ADVANCE);
  });
});

// ── STAGE_OWNERSHIP completeness ─────────────────────────────────────────────

describe('STAGE_OWNERSHIP', () => {
  it('every agent role has an entry in STAGE_OWNERSHIP', () => {
    for (const role of AGENT_ROLES) {
      expect(STAGE_OWNERSHIP[role]).toBeDefined();
      expect(Array.isArray(STAGE_OWNERSHIP[role])).toBe(true);
    }
  });

  it('admin and todo have no stage ownership', () => {
    expect(STAGE_OWNERSHIP.admin).toEqual([]);
    expect(STAGE_OWNERSHIP.todo).toEqual([]);
  });
});
