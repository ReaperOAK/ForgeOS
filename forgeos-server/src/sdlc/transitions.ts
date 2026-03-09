/**
 * SDLC Stage Transition Helpers.
 *
 * Pure functions for querying SDLC flow relationships. These helpers
 * are used by MCP tool handlers to determine valid stage transitions,
 * identify implementation entry points, and validate flow ordering.
 *
 * All functions are deterministic and side-effect-free.
 *
 * @module sdlc/transitions
 * @ticket TASK-FOS-03-004
 */

import { SDLC_FLOWS } from './flows.js';
import type { TicketType, TicketStage } from '../types/index.js';

/**
 * Returns the next stage in the SDLC flow for the given ticket type
 * and current stage, or null if at the final stage or stage not found.
 */
export function getNextStage(
  type: TicketType,
  currentStage: TicketStage,
): TicketStage | null {
  const flow = SDLC_FLOWS[type];
  if (!flow) return null;

  const idx = flow.indexOf(currentStage);
  if (idx === -1 || idx === flow.length - 1) return null;

  return flow[idx + 1] as TicketStage;
}

/**
 * Returns the implementation entry stage for a ticket type.
 * This is the first stage after READY in the flow.
 */
export function getImplementationStage(
  type: TicketType,
): TicketStage | null {
  const flow = SDLC_FLOWS[type];
  if (!flow || flow.length < 2) return null;

  return flow[1] as TicketStage;
}

/**
 * Validates whether a transition from one stage to another is a legal
 * forward-only move in the given ticket type SDLC flow.
 * A transition is valid iff to is the immediate successor of from.
 */
export function isValidTransition(
  type: TicketType,
  from: TicketStage,
  to: TicketStage,
): boolean {
  return getNextStage(type, from) === to;
}
