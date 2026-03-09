/**
 * SDLC Flow Definitions.
 *
 * Re-exports the canonical SDLC_FLOWS mapping from types/index.ts as
 * a read-only constant. This module exists to provide a clean import
 * path for SDLC flow logic without pulling in the entire types barrel.
 *
 * @module sdlc/flows
 * @ticket TASK-FOS-03-004
 */

import { SDLC_FLOWS as _flows } from '../types/index.js';
import type { TicketType, TicketStage } from '../types/index.js';

/**
 * Immutable mapping of ticket type to its ordered SDLC stage sequence.
 *
 * Every flow starts with READY and ends with DONE. The VALIDATOR stage
 * always immediately precedes DONE.
 */
export const SDLC_FLOWS: Readonly<Record<TicketType, readonly TicketStage[]>> = _flows;
