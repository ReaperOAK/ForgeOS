/**
 * Tests — transitions.ts (SDLC stage transition helpers)
 *
 * Unit tests for getNextStage(), getImplementationStage(), and
 * isValidTransition(). Validates all 10 ticket types, boundary
 * conditions, and flow correctness per Architecture §6.4.
 *
 * @module __tests__/sdlc/transitions
 * @ticket TASK-FOS-03-004
 */

import { describe, it, expect } from 'vitest';
import { getNextStage, getImplementationStage, isValidTransition } from '../../sdlc/transitions.js';
import { SDLC_FLOWS } from '../../sdlc/flows.js';
import type { TicketType, TicketStage } from '../../types/index.js';

// ═════════════════════════════════════════════════════════════════════════════
// 1. SDLC_FLOWS CORRECTNESS (AC6)
// ═════════════════════════════════════════════════════════════════════════════

describe('SDLC_FLOWS — AC6: correct stage arrays for all 10 ticket types', () => {
  it('defines flows for exactly 10 ticket types', () => {
    const types: TicketType[] = [
      'backend', 'frontend', 'fullstack', 'infra', 'security',
      'docs', 'research', 'architecture', 'product', 'design',
    ];
    expect(Object.keys(SDLC_FLOWS)).toHaveLength(10);
    for (const t of types) {
      expect(SDLC_FLOWS[t]).toBeDefined();
    }
  });

  it('every flow starts with READY and ends with DONE', () => {
    for (const [type, flow] of Object.entries(SDLC_FLOWS)) {
      expect(flow[0]).toBe('READY');
      expect(flow[flow.length - 1]).toBe('DONE');
    }
  });

  it('backend flow matches architecture spec', () => {
    expect(SDLC_FLOWS.backend).toEqual([
      'READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE',
    ]);
  });

  it('frontend flow includes UI_DESIGN before FRONTEND', () => {
    expect(SDLC_FLOWS.frontend).toEqual([
      'READY', 'UI_DESIGN', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE',
    ]);
  });

  it('fullstack flow includes both BACKEND and FRONTEND', () => {
    const flow = SDLC_FLOWS.fullstack;
    const backendIdx = flow.indexOf('BACKEND');
    const frontendIdx = flow.indexOf('FRONTEND');
    expect(backendIdx).toBeGreaterThan(-1);
    expect(frontendIdx).toBeGreaterThan(backendIdx);
  });

  it('security flow starts with SECURITY after READY', () => {
    expect(SDLC_FLOWS.security[1]).toBe('SECURITY');
  });

  it('docs flow is minimal (4 stages)', () => {
    expect(SDLC_FLOWS.docs).toEqual([
      'READY', 'DOCUMENTATION', 'VALIDATOR', 'DONE',
    ]);
  });

  it('every flow contains VALIDATOR before DONE', () => {
    for (const [, flow] of Object.entries(SDLC_FLOWS)) {
      const validatorIdx = flow.indexOf('VALIDATOR');
      const doneIdx = flow.indexOf('DONE');
      expect(validatorIdx).toBeGreaterThan(-1);
      expect(doneIdx).toBe(validatorIdx + 1);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. getNextStage (AC7)
// ═════════════════════════════════════════════════════════════════════════════

describe('getNextStage — AC7: correct next stage or null', () => {
  it('returns QA after BACKEND for backend type', () => {
    expect(getNextStage('backend', 'BACKEND')).toBe('QA');
  });

  it('returns DONE after VALIDATOR for backend type', () => {
    expect(getNextStage('backend', 'VALIDATOR')).toBe('DONE');
  });

  it('returns null when at DONE (final stage)', () => {
    expect(getNextStage('backend', 'DONE')).toBeNull();
  });

  it('returns null for stage not in flow', () => {
    // FRONTEND is not in backend flow
    expect(getNextStage('backend', 'FRONTEND')).toBeNull();
  });

  it('returns FRONTEND after UI_DESIGN for frontend type', () => {
    expect(getNextStage('frontend', 'UI_DESIGN')).toBe('FRONTEND');
  });

  it('traverses entire backend flow correctly', () => {
    const flow = SDLC_FLOWS.backend;
    for (let i = 0; i < flow.length - 1; i++) {
      expect(getNextStage('backend', flow[i] as TicketStage)).toBe(flow[i + 1]);
    }
    expect(getNextStage('backend', flow[flow.length - 1] as TicketStage)).toBeNull();
  });

  it('traverses entire fullstack flow correctly', () => {
    const flow = SDLC_FLOWS.fullstack;
    for (let i = 0; i < flow.length - 1; i++) {
      expect(getNextStage('fullstack', flow[i] as TicketStage)).toBe(flow[i + 1]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. getImplementationStage
// ═════════════════════════════════════════════════════════════════════════════

describe('getImplementationStage — first stage after READY', () => {
  it('returns BACKEND for backend type', () => {
    expect(getImplementationStage('backend')).toBe('BACKEND');
  });

  it('returns UI_DESIGN for frontend type', () => {
    expect(getImplementationStage('frontend')).toBe('UI_DESIGN');
  });

  it('returns UI_DESIGN for fullstack type', () => {
    expect(getImplementationStage('fullstack')).toBe('UI_DESIGN');
  });

  it('returns SECURITY for security type', () => {
    expect(getImplementationStage('security')).toBe('SECURITY');
  });

  it('returns DOCUMENTATION for docs type', () => {
    expect(getImplementationStage('docs')).toBe('DOCUMENTATION');
  });

  it('returns RESEARCH for research type', () => {
    expect(getImplementationStage('research')).toBe('RESEARCH');
  });

  it('returns ARCHITECT for architecture type', () => {
    expect(getImplementationStage('architecture')).toBe('ARCHITECT');
  });

  it('returns PRODUCT_MANAGER for product type', () => {
    expect(getImplementationStage('product')).toBe('PRODUCT_MANAGER');
  });

  it('returns UI_DESIGN for design type', () => {
    expect(getImplementationStage('design')).toBe('UI_DESIGN');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. isValidTransition
// ═════════════════════════════════════════════════════════════════════════════

describe('isValidTransition — validates forward-only transitions', () => {
  it('returns true for BACKEND → QA (backend)', () => {
    expect(isValidTransition('backend', 'BACKEND', 'QA')).toBe(true);
  });

  it('returns true for VALIDATOR → DONE (backend)', () => {
    expect(isValidTransition('backend', 'VALIDATOR', 'DONE')).toBe(true);
  });

  it('returns false for BACKEND → SECURITY (skips QA)', () => {
    expect(isValidTransition('backend', 'BACKEND', 'SECURITY')).toBe(false);
  });

  it('returns false for DONE → QA (beyond final)', () => {
    expect(isValidTransition('backend', 'DONE', 'QA')).toBe(false);
  });

  it('returns false for backward transition QA → BACKEND', () => {
    expect(isValidTransition('backend', 'QA', 'BACKEND')).toBe(false);
  });

  it('returns true for READY → BACKEND (backend)', () => {
    expect(isValidTransition('backend', 'READY', 'BACKEND')).toBe(true);
  });

  it('returns true for READY → UI_DESIGN (frontend)', () => {
    expect(isValidTransition('frontend', 'READY', 'UI_DESIGN')).toBe(true);
  });

  it('returns false for same-stage transition', () => {
    expect(isValidTransition('backend', 'BACKEND', 'BACKEND')).toBe(false);
  });
});
