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

/**
 * Thrown by `compileTicketPrompt` (and related helpers) when a compiled prompt
 * packet fails the 11-section structural validation enforced by
 * `validatePacketSections`.
 *
 * The full machine-readable `ValidationResult` is available on the `result`
 * property for structured logging and debugging. Use `toPublicMessage()` when
 * surfacing a failure message at an external or transport boundary.
 *
 * @example
 * ```ts
 * const result = validatePacketSections(prompt);
 * if (!result.valid) {
 *   throw new PacketValidationError(result);
 * }
 * ```
 */
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
     *
     * @returns A fixed, non-leaking error string safe to forward to API clients.
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

    return patterns
        .flatMap((pattern) => Array.from(text.matchAll(pattern)))
        .filter((match) => match.index !== undefined)
        .map((match) => ({
            index: match.index as number,
            length: match[0].length,
        }))
        .sort((a, b) => a.index - b.index);
}

/** Returns true when the section body contains any canonical section header marker. */
function containsCanonicalHeader(body: string): boolean {
    return REQUIRED_SECTIONS.some((section) => {
        const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [new RegExp(`\\*\\*${escaped}\\*\\*`, 'i'), new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'mi')];
        return patterns.some((pattern) => pattern.test(body));
    });
}

/**
 * Parse canonical section headers from prompt text and capture each section body.
 * Duplicate headers are marked using internal `__duplicate:<SECTION>` keys.
 */
export function extractSections(prompt: string): Map<string, string> {
    if (!prompt || prompt.trim().length === 0) {
        return new Map<string, string>();
    }

    const sections = new Map<string, string>();
    const foundHeaders = REQUIRED_SECTIONS.flatMap((section) => {
        const matches = findSectionMatches(prompt, section);
        if (matches.length > 1) {
            sections.set(`__duplicate:${section}`, section);
            return [];
        }

        if (matches.length === 0) {
            return [];
        }

        const match = matches[0] as { index: number; length: number };
        return [{ section, index: match.index, length: match.length }];
    }).sort((a, b) => a.index - b.index);

    foundHeaders.forEach((current, index) => {
        const nextHeaderIndex = foundHeaders[index + 1]?.index ?? prompt.length;
        const bodyStart = current.index + current.length;
        const body = prompt.slice(bodyStart, nextHeaderIndex).trim();
        sections.set(current.section, body);
    });

    return sections;
}

/** Validate canonical section presence and order. */
export function validateSectionOrder(sections: Map<string, string>): ValidationResult {
    const duplicateSections = REQUIRED_SECTIONS.filter((section) =>
        sections.has(`__duplicate:${section}`),
    );
    if (duplicateSections.length > 0) {
        return {
            valid: false,
            missingSections: [],
            misordered: [],
            structuredReason: `Duplicate section headers detected: ${duplicateSections.join(', ')}`,
        };
    }

    const missingSections = REQUIRED_SECTIONS.filter((section) => !sections.has(section));
    if (missingSections.length > 0) {
        return {
            valid: false,
            missingSections,
            misordered: [],
            structuredReason: `Missing sections: ${missingSections.join(', ')}`,
        };
    }

    const actualOrder = [...sections.keys()].filter((section): section is RequiredSection =>
        REQUIRED_SECTIONS.includes(section as RequiredSection),
    );
    const misordered = actualOrder.filter((section, index) => section !== REQUIRED_SECTIONS[index]);
    if (misordered.length > 0) {
        return {
            valid: false,
            missingSections: [],
            misordered,
            structuredReason: `Sections are misordered. Expected: ${REQUIRED_SECTIONS.join(' → ')}. Actual: ${actualOrder.join(' → ')}.`,
        };
    }

    return {
        valid: true,
        missingSections: [],
        misordered: [],
        structuredReason: 'Section order is valid.',
    };
}

/** Validate semantic section body requirements (non-empty and no nested headers). */
export function validateSectionBodies(sections: Map<string, string>): ValidationResult {
    const emptyBodySection = REQUIRED_SECTIONS.find((section) => (sections.get(section)?.trim().length ?? 0) === 0);
    if (emptyBodySection !== undefined) {
        return {
            valid: false,
            missingSections: [],
            misordered: [],
            structuredReason: `Section body is empty for: ${emptyBodySection}`,
        };
    }

    const nestedHeaderSection = REQUIRED_SECTIONS.find((section) => {
        const body = sections.get(section);
        if (body === undefined) {
            return false;
        }
        return containsCanonicalHeader(body);
    });
    if (nestedHeaderSection !== undefined) {
        return {
            valid: false,
            missingSections: [],
            misordered: [],
            structuredReason: `Section body contains nested canonical header marker for: ${nestedHeaderSection}`,
        };
    }

    return {
        valid: true,
        missingSections: [],
        misordered: [],
        structuredReason: 'Section bodies are valid.',
    };
}

/**
 * Validate that a compiled packet contains all 11 required sections in the
 * exact canonical order specified in architecture doc §5.1.
 *
 * The 11 required sections are (in order):
 * ROLE → TICKET → SYSTEM CONSTRAINTS → HISTORY → LEARNINGS → BEST PRACTICES
 * → CONTEXT LOCATIONS → YOUR EXACT TASK → EXECUTION PLAN → EDGE CASES
 * → POST-COMPLETION.
 *
 * Each section must:
 * - Appear exactly once (duplicates are rejected).
 * - Appear in the canonical order defined above.
 * - Have a non-empty body.
 * - Not contain a nested canonical section header in its body.
 *
 * This function never throws. The caller is responsible for throwing
 * `PacketValidationError` when `valid` is `false`.
 *
 * @param text - The full rendered packet text to validate.
 * @returns A `ValidationResult` with `valid: true` on success, or
 *   `valid: false` with `missingSections`, `misordered`, and
 *   `structuredReason` describing the first detected failure.
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

    const sections = extractSections(text);
    const orderResult = validateSectionOrder(sections);
    if (!orderResult.valid) {
        return orderResult;
    }

    const bodyResult = validateSectionBodies(sections);
    if (!bodyResult.valid) {
        return bodyResult;
    }

    return {
        valid: true,
        missingSections: [],
        misordered: [],
        structuredReason: 'All 11 sections present in correct order.',
    };
}
