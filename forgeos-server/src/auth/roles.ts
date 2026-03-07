/**
 * Role-based permission matrix for ForgeOS agent authorization.
 *
 * Defines the mapping between agent roles and their permitted operations.
 * Each agent role corresponds to an SDLC stage and can only perform
 * operations matching their stage ownership. The admin role has unrestricted
 * access via the wildcard `"*"` permission.
 *
 * @module auth/roles
 * @ticket TASK-FOS-04-001
 */

// ── Permission Constants ─────────────────────────────────────────────────────

/**
 * All valid permission strings in the ForgeOS system.
 *
 * Permissions follow a `resource.action` naming convention and map to
 * MCP tool operations.
 */
export const PERMISSIONS = {
  /** Retrieve the next available ticket for a given stage. */
  TICKETS_NEXT: 'tickets.next',
  /** Claim a ticket via the two-commit protocol. */
  TICKETS_CLAIM: 'tickets.claim',
  /** Advance a ticket to the next SDLC stage. */
  TICKETS_ADVANCE: 'tickets.advance',
  /** Reject a ticket and send it back for rework. */
  TICKETS_REJECT: 'tickets.reject',
  /** Update ticket metadata. */
  TICKETS_UPDATE: 'tickets.update',
  /** Spawn a child ticket. */
  TICKETS_SPAWN: 'tickets.spawn',
  /** View the dependency graph. */
  TICKETS_GRAPH: 'tickets.graph',
  /** Release a claim on a ticket. */
  TICKETS_RELEASE: 'tickets.release',
  /** Extend a lease on a claimed ticket. */
  TICKETS_EXTEND: 'tickets.extend',
  /** View system-wide ticket statistics. */
  TICKETS_STATS: 'tickets.stats',
  /** Force-release another agent's claim (admin only). */
  ADMIN_FORCE_RELEASE: 'admin.force_release',
  /** Manage agent API keys (admin only). */
  ADMIN_MANAGE_KEYS: 'admin.manage_keys',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/** Wildcard permission granting unrestricted access. */
const WILDCARD: string = '*';

// ── Agent Role Definitions ───────────────────────────────────────────────────

/**
 * All recognized agent roles in the ForgeOS system.
 *
 * Each role maps to an SDLC stage and determines which operations
 * the agent can perform.
 */
export type AgentRole =
  | 'admin'
  | 'architect'
  | 'research'
  | 'product_manager'
  | 'ui_designer'
  | 'backend'
  | 'frontend'
  | 'qa'
  | 'security'
  | 'ci_reviewer'
  | 'documentation'
  | 'validator'
  | 'devops'
  | 'todo';

/**
 * All valid agent role values as an array for runtime validation.
 */
export const AGENT_ROLES: readonly AgentRole[] = [
  'admin',
  'architect',
  'research',
  'product_manager',
  'ui_designer',
  'backend',
  'frontend',
  'qa',
  'security',
  'ci_reviewer',
  'documentation',
  'validator',
  'devops',
  'todo',
] as const;

// ── SDLC Stage Ownership ────────────────────────────────────────────────────

/**
 * Maps agent roles to the SDLC stages they own.
 *
 * An agent can only claim tickets that are in a stage they own.
 * Admin has no stage-specific ownership — it is handled separately
 * via the wildcard permission.
 */
export const STAGE_OWNERSHIP: Record<AgentRole, readonly string[]> = {
  admin: [],
  architect: ['ARCHITECT'],
  research: ['RESEARCH'],
  product_manager: ['PRODUCT_MANAGER'],
  ui_designer: ['UI_DESIGN'],
  backend: ['BACKEND'],
  frontend: ['FRONTEND'],
  qa: ['QA'],
  security: ['SECURITY'],
  ci_reviewer: ['CI'],
  documentation: ['DOCUMENTATION'],
  validator: ['VALIDATOR'],
  devops: ['BACKEND'],
  todo: [],
};

// ── Permission Matrix ────────────────────────────────────────────────────────

/**
 * Complete role-based permission matrix.
 *
 * Each role is granted a specific set of permissions. The admin role
 * receives the wildcard `"*"` which grants all permissions. Implementation
 * agents (backend, frontend, etc.) can claim, advance, update, extend,
 * and release tickets in their owned stages. Review agents (qa, security,
 * ci_reviewer, validator) can additionally reject tickets.
 *
 * @see {@link hasPermission} for the authorization check function
 */
export const ROLE_PERMISSIONS: Record<AgentRole, readonly string[]> = {
  admin: [WILDCARD],

  architect: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
    PERMISSIONS.TICKETS_SPAWN,
  ],

  research: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  product_manager: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
    PERMISSIONS.TICKETS_SPAWN,
  ],

  ui_designer: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  backend: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
    PERMISSIONS.TICKETS_SPAWN,
  ],

  frontend: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
    PERMISSIONS.TICKETS_SPAWN,
  ],

  qa: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_REJECT,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  security: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_REJECT,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  ci_reviewer: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_REJECT,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  documentation: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  validator: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_REJECT,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  devops: [
    PERMISSIONS.TICKETS_NEXT,
    PERMISSIONS.TICKETS_CLAIM,
    PERMISSIONS.TICKETS_ADVANCE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_RELEASE,
    PERMISSIONS.TICKETS_EXTEND,
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
  ],

  todo: [
    PERMISSIONS.TICKETS_GRAPH,
    PERMISSIONS.TICKETS_STATS,
    PERMISSIONS.TICKETS_SPAWN,
  ],
};

// ── Authorization Functions ──────────────────────────────────────────────────

/**
 * Check whether a set of granted permissions includes the required permission.
 *
 * Supports the wildcard `"*"` which grants all permissions.
 *
 * @param grantedPermissions - Permissions granted to the agent
 * @param requiredPermission - The permission to check for
 * @returns `true` if the agent has the required permission
 *
 * @example
 * ```ts
 * hasPermission(['tickets.claim', 'tickets.advance'], 'tickets.claim'); // true
 * hasPermission(['*'], 'admin.force_release'); // true (wildcard)
 * hasPermission(['tickets.next'], 'tickets.claim'); // false
 * ```
 */
export function hasPermission(
  grantedPermissions: readonly string[],
  requiredPermission: string,
): boolean {
  return grantedPermissions.includes(WILDCARD) || grantedPermissions.includes(requiredPermission);
}

/**
 * Check whether a role is valid (recognized by the system).
 *
 * @param role - The role string to validate
 * @returns `true` if the role is a valid {@link AgentRole}
 */
export function isValidRole(role: string): role is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(role);
}

/**
 * Get the default permissions for a given role.
 *
 * Returns an empty array for unrecognized roles.
 *
 * @param role - The agent role
 * @returns Array of permission strings granted to the role
 */
export function getPermissionsForRole(role: string): readonly string[] {
  if (!isValidRole(role)) {
    return [];
  }
  return ROLE_PERMISSIONS[role];
}

/**
 * Check whether a role can claim tickets in a given SDLC stage.
 *
 * Admin role can claim tickets in any stage. Other roles can only claim
 * tickets in the stages they own (see {@link STAGE_OWNERSHIP}).
 *
 * @param role - The agent role
 * @param stage - The SDLC stage to check
 * @returns `true` if the role can operate in the given stage
 *
 * @example
 * ```ts
 * canOperateInStage('backend', 'BACKEND');   // true
 * canOperateInStage('backend', 'QA');        // false
 * canOperateInStage('admin', 'BACKEND');     // true (admin has full access)
 * ```
 */
export function canOperateInStage(role: string, stage: string): boolean {
  if (role === 'admin') {
    return true;
  }
  if (!isValidRole(role)) {
    return false;
  }
  return STAGE_OWNERSHIP[role].includes(stage);
}
