/**
 * Packet Validator — enforces strict 11-section schema for compiled execution packets.
 *
 * Architecture reference: docs/architecture/prompt-compiler-architecture.md §5.1
 *
 * @ticket TASK-PC-BE-004
 */

/**
 * Canonical ordered list of required sections per architecture doc §5.1.
 * Section names are exact, uppercase, and immutable.
 */
export const REQUIRED_SECTIONS = [
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
] as const;

export type RequiredSection = (typeof REQUIRED_SECTIONS)[number];

export interface ValidationResult {
    valid: boolean;
    missingSections: string[];
    misordered: string[];
    structuredReason: string;
}

export class PacketValidationError extends Error {
    public readonly result: ValidationResult;

    constructor(result: ValidationResult) {
        super(`Packet validation failed: ${result.structuredReason}`);
        this.name = 'PacketValidationError';
        this.result = result;
    }
}

/**
 * Locate the character index of a section header within the rendered packet text.
 * Matches **SECTION NAME** (bold markdown) and ## SECTION NAME (markdown headings).
 */
function findSectionIndex(text: string, sectionName: string): number {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`\\*\\*${escaped}\\*\\*`, 'i'),
        new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'mi'),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match !== null) {
            return match.index;
        }
    }
    return -1;
}

/**
 * Validate that a compiled packet contains all 11 required sections in the
 * exact canonical order specified in architecture doc §5.1.
 *
 * Returns a `ValidationResult` with `valid: true` on success or a structured
 * failure describing which sections are missing or misordered.
 */
export function validatePacketSections(text: string): ValidationResult {
    if (!text || text.trim().length === 0) {
        return {
            valid: false,
            missingSections: [...REQUIRED_SECTIONS],
            misordered: [],
            structuredReason: 'Packet text is empty or missing all required sections.',
        };
    }

    const positions = new Map<string, number>();
    const missingSections: string[] = [];

    for (const section of REQUIRED_SECTIONS) {
        const idx = findSectionIndex(text, section);
        if (idx === -1) {
            missingSections.push(section);
        } else {
            positions.set(section, idx);
        }
    }

    if (missingSections.length > 0) {
        return {
            valid: false,
            missingSections,
            misordered: [],
            structuredReason: `Missing sections: ${missingSections.join(', ')}`,
        };
    }

    // All sections present — verify canonical ordering
    const presentSections = REQUIRED_SECTIONS.filter((s) => positions.has(s));
    const actualOrder = [...presentSections].sort(
        (a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0),
    );

    const misordered: string[] = [];
    for (let i = 0; i < presentSections.length; i++) {
        const actual = actualOrder[i];
        if (actual !== undefined && actual !== presentSections[i]) {
            misordered.push(actual);
        }
    }

    if (misordered.length > 0) {
        return {
            valid: false,
            missingSections: [],
            misordered,
            structuredReason: `Sections are misordered. Expected: ${presentSections.join(' → ')}. Actual: ${actualOrder.join(' → ')}.`,
        };
    }

    return {
        valid: true,
        missingSections: [],
        misordered: [],
        structuredReason: 'All 11 sections present in correct order.',
    };
}
