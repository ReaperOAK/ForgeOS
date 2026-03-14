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

    /**
     * Returns a sanitized, transport-safe message for external boundaries.
     * Internal validation details remain available on `result` for logging/debugging.
     */
    public toPublicMessage(): string {
        return 'Packet validation failed. Packet structure is invalid.';
    }
}

/**
 * Locate all occurrences of a section header within the rendered packet text.
 * Matches **SECTION NAME** (bold markdown) and ## SECTION NAME (markdown headings).
 */
function findSectionMatches(
    text: string,
    sectionName: string,
): Array<{ index: number; length: number }> {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`\\*\\*${escaped}\\*\\*`, 'gi'),
        new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'gmi'),
    ];

    const matches: Array<{ index: number; length: number }> = [];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            if (match.index !== undefined) {
                matches.push({ index: match.index, length: match[0].length });
            }
        }
    }

    return matches.sort((a, b) => a.index - b.index);
}

/** Returns true when the section body contains any canonical section header marker. */
function containsCanonicalHeader(body: string): boolean {
    for (const section of REQUIRED_SECTIONS) {
        const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [new RegExp(`\\*\\*${escaped}\\*\\*`, 'i'), new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'mi')];
        if (patterns.some((pattern) => pattern.test(body))) {
            return true;
        }
    }

    return false;
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

    const headers = new Map<string, { index: number; length: number }>();
    const missingSections: string[] = [];
    const duplicateSections: string[] = [];

    for (const section of REQUIRED_SECTIONS) {
        const matches = findSectionMatches(text, section);
        if (matches.length === 0) {
            missingSections.push(section);
        } else if (matches.length > 1) {
            duplicateSections.push(section);
        } else {
            headers.set(section, matches[0] as { index: number; length: number });
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

    if (duplicateSections.length > 0) {
        return {
            valid: false,
            missingSections: [],
            misordered: [],
            structuredReason: `Duplicate section headers detected: ${duplicateSections.join(', ')}`,
        };
    }

    // All sections present — verify canonical ordering
    const presentSections = REQUIRED_SECTIONS.filter((s) => headers.has(s));
    const actualOrder = [...presentSections].sort(
        (a, b) => (headers.get(a)?.index ?? 0) - (headers.get(b)?.index ?? 0),
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

    // Enforce section-body semantics for anti-evasion: non-empty body and no nested canonical headers.
    for (let i = 0; i < REQUIRED_SECTIONS.length; i++) {
        const section = REQUIRED_SECTIONS[i] as string;
        const current = headers.get(section);
        if (!current) {
            continue;
        }

        const nextSection = REQUIRED_SECTIONS[i + 1] as string | undefined;
        const nextHeaderIndex =
            nextSection !== undefined
                ? (headers.get(nextSection)?.index ?? text.length)
                : text.length;

        const body = text.slice(current.index + current.length, nextHeaderIndex).trim();
        if (body.length === 0) {
            return {
                valid: false,
                missingSections: [],
                misordered: [],
                structuredReason: `Section body is empty for: ${section}`,
            };
        }

        if (containsCanonicalHeader(body)) {
            return {
                valid: false,
                missingSections: [],
                misordered: [],
                structuredReason: `Section body contains nested canonical header marker for: ${section}`,
            };
        }
    }

    return {
        valid: true,
        missingSections: [],
        misordered: [],
        structuredReason: 'All 11 sections present in correct order.',
    };
}
