import { normalizeCanonicalToken } from './context-hash.js';

export interface CognitionContextLocation {
    path: string;
    reason: string;
}

export interface CognitionPacketWarning {
    code: 'partial_context';
    message: string;
    source: 'cognition_provider';
}

export interface CognitionSupplementalContext {
    blastRadius: Array<Record<string, unknown>>;
    symbolHints: Array<Record<string, unknown>>;
}

export interface CognitionSnapshot {
    graphVersion: string;
    locations: CognitionContextLocation[];
    warnings: CognitionPacketWarning[];
    partial: boolean;
    supplemental: CognitionSupplementalContext;
}

export interface BuildCognitionSnapshotInput {
    graphVersion: string;
    fileScope: string[];
    fetchSupplementalContext: () => Promise<CognitionSupplementalContext>;
    timeoutMs?: number;
}

type ContextSource = 'file_scope' | 'blast_radius' | 'symbol_hint';

interface LocationCandidate {
    path: string;
    source: ContextSource;
    reason: string;
}

interface TimeoutError extends Error {
    code: 'COGNITION_TIMEOUT';
}

const DEFAULT_TIMEOUT_MS = 1500;

export async function buildCognitionSnapshot(input: BuildCognitionSnapshotInput): Promise<CognitionSnapshot> {
    const graphVersion = normalizeCanonicalToken(input.graphVersion || 'unknown');
    const timeoutMs = resolveTimeoutMs(input.timeoutMs);
    const baseCandidates = buildFileScopeCandidates(input.fileScope);

    try {
        const supplemental = await withTimeout(input.fetchSupplementalContext(), timeoutMs);
        const locations = mergeDeterministicLocations([
            ...baseCandidates,
            ...buildBlastRadiusCandidates(supplemental.blastRadius),
            ...buildSymbolHintCandidates(supplemental.symbolHints),
        ]);

        return {
            graphVersion,
            locations,
            warnings: [],
            partial: false,
            supplemental,
        };
    } catch (error) {
        if (!isCognitionTimeout(error)) {
            throw error;
        }

        return {
            graphVersion,
            locations: mergeDeterministicLocations(baseCandidates),
            warnings: [
                {
                    code: 'partial_context',
                    message: `Cognition provider timed out after ${timeoutMs}ms; packet includes deterministic base context only.`,
                    source: 'cognition_provider',
                },
            ],
            partial: true,
            supplemental: {
                blastRadius: [],
                symbolHints: [],
            },
        };
    }
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return DEFAULT_TIMEOUT_MS;
    }

    return Math.floor(timeoutMs);
}

function buildFileScopeCandidates(fileScope: string[]): LocationCandidate[] {
    return normalizePaths(fileScope).map((path) => ({
        path,
        source: 'file_scope',
        reason: 'Derived from tickets.payload file_scope.',
    }));
}

function buildBlastRadiusCandidates(blastRadius: Array<Record<string, unknown>>): LocationCandidate[] {
    return blastRadius.flatMap((entry) => {
        const sourcePath = typeof entry.file_path === 'string'
            ? entry.file_path.trim()
            : 'related context';

        const affectedFiles = Array.isArray(entry.affected_files)
            ? normalizePaths(entry.affected_files)
            : [];

        return affectedFiles.map((path) => ({
            path,
            source: 'blast_radius',
            reason: `Impacted by blast radius from ${sourcePath}.`,
        }));
    });
}

function buildSymbolHintCandidates(symbolHints: Array<Record<string, unknown>>): LocationCandidate[] {
    return symbolHints.flatMap((entry) => {
        const term = typeof entry.term === 'string' && entry.term.trim().length > 0
            ? entry.term.trim()
            : 'related symbol';
        const symbols = Array.isArray(entry.symbols) ? entry.symbols : [];

        return symbols
            .map(extractSymbolPath)
            .filter((path): path is string => path !== null)
            .map((path) => ({
                path,
                source: 'symbol_hint',
                reason: `Relevant symbol search match for "${term}".`,
            }));
    });
}

function mergeDeterministicLocations(candidates: LocationCandidate[]): CognitionContextLocation[] {
    const grouped = new Map<string, LocationCandidate[]>();

    for (const candidate of candidates) {
        const existing = grouped.get(candidate.path) ?? [];
        existing.push(candidate);
        grouped.set(candidate.path, existing);
    }

    return Array.from(grouped.entries())
        .sort(([leftPath, leftCandidates], [rightPath, rightCandidates]) => {
            const priorityDelta = highestPriority(leftCandidates) - highestPriority(rightCandidates);
            return priorityDelta !== 0 ? priorityDelta : leftPath.localeCompare(rightPath);
        })
        .map(([path, pathCandidates]) => ({
            path,
            reason: buildReason(pathCandidates),
        }));
}

function buildReason(candidates: LocationCandidate[]): string {
    const reasons = Array.from(new Set(candidates.map((candidate) => `${sourcePriority(candidate.source)}:${candidate.reason}`)))
        .sort((left, right) => {
            const [leftPriority, leftReason] = splitReason(left);
            const [rightPriority, rightReason] = splitReason(right);
            return leftPriority === rightPriority
                ? leftReason.localeCompare(rightReason)
                : leftPriority - rightPriority;
        })
        .map((entry) => splitReason(entry)[1]);

    return reasons.join(' ');
}

function splitReason(value: string): [number, string] {
    const separator = value.indexOf(':');
    return [Number(value.slice(0, separator)), value.slice(separator + 1)];
}

function highestPriority(candidates: LocationCandidate[]): number {
    return candidates.reduce((best, candidate) => Math.min(best, sourcePriority(candidate.source)), Number.MAX_SAFE_INTEGER);
}

function sourcePriority(source: ContextSource): number {
    switch (source) {
        case 'file_scope':
            return 0;
        case 'blast_radius':
            return 1;
        case 'symbol_hint':
            return 2;
    }
}

function normalizePaths(values: unknown[]): string[] {
    return values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .sort((left, right) => left.localeCompare(right));
}

function extractSymbolPath(value: unknown): string | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const record = value as Record<string, unknown>;
    const directPath = firstString(record.file_path, record.path, record.filePath, record.file);
    if (directPath) {
        return directPath;
    }

    const location = record.location;
    if (!location || typeof location !== 'object') {
        return null;
    }

    const locationRecord = location as Record<string, unknown>;
    return firstString(locationRecord.file_path, locationRecord.path, locationRecord.filePath, locationRecord.file);
}

function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }

    return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    const error = new Error('Cognition provider timeout') as TimeoutError;
                    error.code = 'COGNITION_TIMEOUT';
                    reject(error);
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

function isCognitionTimeout(error: unknown): error is TimeoutError {
    return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'COGNITION_TIMEOUT';
}