/**
 * Tests for packet-validator.ts — 11-section ordered enforcement.
 *
 * Covers: valid packets, empty/null inputs, missing sections,
 * misordered sections, and PacketValidationError class.
 *
 * @ticket TASK-PC-BE-004
 */

import { describe, expect, it } from 'vitest';
import {
    REQUIRED_SECTIONS,
    PacketValidationError,
    validatePacketSections,
} from './packet-validator.js';

/** Build a rendered packet from the given section array using bold-header format. */
function buildPacket(sections: readonly string[] = REQUIRED_SECTIONS): string {
    return sections.map((s) => `**${s}**\n\nContent for ${s} section.\n`).join('\n');
}

// ---------------------------------------------------------------------------
// REQUIRED_SECTIONS constant
// ---------------------------------------------------------------------------
describe('REQUIRED_SECTIONS', () => {
    it('contains exactly 11 sections', () => {
        expect(REQUIRED_SECTIONS).toHaveLength(11);
    });

    it('begins with ROLE', () => {
        expect(REQUIRED_SECTIONS[0]).toBe('ROLE');
    });

    it('ends with POST-COMPLETION', () => {
        expect(REQUIRED_SECTIONS[10]).toBe('POST-COMPLETION');
    });

    it('contains all canonical section names in order', () => {
        const names = [...REQUIRED_SECTIONS];
        expect(names).toEqual([
            'ROLE',
            'TICKET',
            'SYSTEM CONSTRAINTS',
            'HISTORY',
            'LEARNINGS',
            'BEST PRACTICES',
            'CONTEXT LOCATIONS',
            'YOUR EXACT TASK',
            'EXECUTION PLAN',
            'EDGE CASES',
            'POST-COMPLETION',
        ]);
    });
});

// ---------------------------------------------------------------------------
// validatePacketSections — valid inputs
// ---------------------------------------------------------------------------
describe('validatePacketSections — valid inputs', () => {
    it('returns valid=true for a correctly ordered 11-section packet (bold format)', () => {
        const result = validatePacketSections(buildPacket());
        expect(result.valid).toBe(true);
        expect(result.missingSections).toHaveLength(0);
        expect(result.misordered).toHaveLength(0);
        expect(result.structuredReason).toContain('correct order');
    });

    it('returns valid=true for sections formatted as markdown headings (## format)', () => {
        const packet = REQUIRED_SECTIONS.map((s) => `## ${s}\n\nContent for ${s}.\n`).join('\n');
        const result = validatePacketSections(packet);
        expect(result.valid).toBe(true);
        expect(result.missingSections).toHaveLength(0);
        expect(result.misordered).toHaveLength(0);
    });

    it('returns valid=true when sections have substantial multi-line body text', () => {
        const packet = REQUIRED_SECTIONS.map(
            (s) =>
                `**${s}**\n\nThis is a longer body for ${s}. Multiple lines follow.\n` +
                'Additional context.\n- Bullet 1\n- Bullet 2\n' +
                'Even more detail here.\n',
        ).join('\n');
        const result = validatePacketSections(packet);
        expect(result.valid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// validatePacketSections — empty / no-content inputs
// ---------------------------------------------------------------------------
describe('validatePacketSections — empty inputs', () => {
    it('returns valid=false with all 11 sections in missingSections for empty string', () => {
        const result = validatePacketSections('');
        expect(result.valid).toBe(false);
        expect(result.missingSections).toHaveLength(11);
        expect(result.structuredReason).toContain('empty');
    });

    it('returns valid=false with all 11 sections in missingSections for whitespace-only string', () => {
        const result = validatePacketSections('   \n   \t  ');
        expect(result.valid).toBe(false);
        expect(result.missingSections).toHaveLength(11);
        expect(result.misordered).toHaveLength(0);
    });

    it('returns valid=false for plain prose with no recognisable section headers', () => {
        const result = validatePacketSections('This is a plain prompt with no sections.');
        expect(result.valid).toBe(false);
        expect(result.missingSections).toHaveLength(11);
    });
});

// ---------------------------------------------------------------------------
// validatePacketSections — missing sections
// ---------------------------------------------------------------------------
describe('validatePacketSections — missing sections', () => {
    it('reports SYSTEM CONSTRAINTS as missing when omitted', () => {
        const sectionNames = REQUIRED_SECTIONS.filter((s) => s !== 'SYSTEM CONSTRAINTS');
        const result = validatePacketSections(buildPacket(sectionNames));
        expect(result.valid).toBe(false);
        expect(result.missingSections).toContain('SYSTEM CONSTRAINTS');
        expect(result.missingSections).toHaveLength(1);
    });

    it('reports EXECUTION PLAN as missing when omitted', () => {
        const sectionNames = REQUIRED_SECTIONS.filter((s) => s !== 'EXECUTION PLAN');
        const result = validatePacketSections(buildPacket(sectionNames));
        expect(result.valid).toBe(false);
        expect(result.missingSections).toContain('EXECUTION PLAN');
        expect(result.missingSections).toHaveLength(1);
    });

    it('reports EDGE CASES as missing when omitted', () => {
        const sectionNames = REQUIRED_SECTIONS.filter((s) => s !== 'EDGE CASES');
        const result = validatePacketSections(buildPacket(sectionNames));
        expect(result.valid).toBe(false);
        expect(result.missingSections).toContain('EDGE CASES');
        expect(result.missingSections).toHaveLength(1);
    });

    it('identifies only the 9 absent sections when packet has only ROLE and TICKET', () => {
        const packet = '**ROLE**\n\nRole content.\n\n**TICKET**\n\nTicket content.';
        const result = validatePacketSections(packet);
        expect(result.valid).toBe(false);
        expect(result.missingSections).not.toContain('ROLE');
        expect(result.missingSections).not.toContain('TICKET');
        expect(result.missingSections).toHaveLength(9);
    });

    it('includes missing section names in structuredReason', () => {
        const result = validatePacketSections('**ROLE**\n\nOnly role.');
        expect(result.structuredReason).toMatch(/Missing sections/i);
        expect(result.structuredReason).toContain('SYSTEM CONSTRAINTS');
        expect(result.structuredReason).toContain('EXECUTION PLAN');
    });

    it('sets misordered to an empty array when sections are missing (not a reorder problem)', () => {
        const result = validatePacketSections('**ROLE**\n\nOnly role.');
        expect(result.misordered).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// validatePacketSections — misordered sections
// ---------------------------------------------------------------------------
describe('validatePacketSections — misordered sections', () => {
    it('returns valid=false when TICKET appears before ROLE', () => {
        const reordered = ['TICKET', 'ROLE', ...REQUIRED_SECTIONS.slice(2)] as string[];
        const result = validatePacketSections(buildPacket(reordered));
        expect(result.valid).toBe(false);
        expect(result.misordered.length).toBeGreaterThan(0);
        expect(result.missingSections).toHaveLength(0);
    });

    it('returns valid=false when POST-COMPLETION appears first', () => {
        const reordered = [
            'POST-COMPLETION',
            ...REQUIRED_SECTIONS.filter((s) => s !== 'POST-COMPLETION'),
        ] as string[];
        const result = validatePacketSections(buildPacket(reordered));
        expect(result.valid).toBe(false);
        expect(result.misordered.length).toBeGreaterThan(0);
    });

    it('returns valid=false for reversed section order', () => {
        const reversed = [...REQUIRED_SECTIONS].reverse() as string[];
        const result = validatePacketSections(buildPacket(reversed));
        expect(result.valid).toBe(false);
        expect(result.misordered.length).toBeGreaterThan(0);
        expect(result.missingSections).toHaveLength(0);
    });

    it('includes canonical ordering detail in structuredReason', () => {
        const reordered = ['TICKET', 'ROLE', ...REQUIRED_SECTIONS.slice(2)] as string[];
        const result = validatePacketSections(buildPacket(reordered));
        expect(result.structuredReason).toMatch(/misordered/i);
        expect(result.structuredReason).toContain('Expected:');
        expect(result.structuredReason).toContain('Actual:');
    });
});

// ---------------------------------------------------------------------------
// validatePacketSections — section-body semantics / anti-evasion
// ---------------------------------------------------------------------------
describe('validatePacketSections — section-body semantics', () => {
    it('returns valid=false when a required section body is empty', () => {
        const packet = REQUIRED_SECTIONS.map((section, idx) => {
            if (idx === 3) {
                return `**${section}**\n\n`;
            }
            return `**${section}**\n\nContent for ${section}.\n`;
        }).join('\n');

        const result = validatePacketSections(packet);
        expect(result.valid).toBe(false);
        expect(result.structuredReason).toContain('Section body is empty for: HISTORY');
    });

    it('returns valid=false when a section body contains a canonical header marker', () => {
        const packet = REQUIRED_SECTIONS.map((section, idx) => {
            if (idx === 2) {
                return `**${section}**\n\nNormal text.\n**EXECUTION PLAN** hidden marker.\n`;
            }
            return `**${section}**\n\nContent for ${section}.\n`;
        }).join('\n');

        const result = validatePacketSections(packet);
        expect(result.valid).toBe(false);
        expect(result.structuredReason).toMatch(
            /Duplicate section headers detected|Section body contains nested canonical header marker/i,
        );
    });
});

// ---------------------------------------------------------------------------
// PacketValidationError class
// ---------------------------------------------------------------------------
describe('PacketValidationError', () => {
    it('is an instance of Error', () => {
        const err = new PacketValidationError({
            valid: false,
            missingSections: ['ROLE'],
            misordered: [],
            structuredReason: 'Missing sections: ROLE',
        });
        expect(err).toBeInstanceOf(Error);
    });

    it('has name PacketValidationError', () => {
        const err = new PacketValidationError({
            valid: false,
            missingSections: [],
            misordered: ['TICKET'],
            structuredReason: 'Sections are misordered.',
        });
        expect(err.name).toBe('PacketValidationError');
    });

    it('message includes the structuredReason', () => {
        const reason = 'Missing sections: ROLE, TICKET';
        const err = new PacketValidationError({
            valid: false,
            missingSections: ['ROLE', 'TICKET'],
            misordered: [],
            structuredReason: reason,
        });
        expect(err.message).toContain('Packet validation failed');
        expect(err.message).toContain(reason);
    });

    it('exposes the original ValidationResult on .result', () => {
        const mockResult = {
            valid: false,
            missingSections: ['EXECUTION PLAN'],
            misordered: [],
            structuredReason: 'Missing sections: EXECUTION PLAN',
        };
        const err = new PacketValidationError(mockResult);
        expect(err.result).toBe(mockResult);
        expect(err.result.missingSections).toContain('EXECUTION PLAN');
    });

    it('provides a sanitized public message without internal validation details', () => {
        const err = new PacketValidationError({
            valid: false,
            missingSections: ['ROLE'],
            misordered: [],
            structuredReason: 'Missing sections: ROLE',
        });

        expect(err.toPublicMessage()).toBe(
            'Packet validation failed. Packet structure is invalid.',
        );
        expect(err.toPublicMessage()).not.toContain('ROLE');
        expect(err.toPublicMessage()).not.toContain('Missing sections');
    });
});
