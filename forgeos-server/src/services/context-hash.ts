import { createHash } from 'node:crypto';

export type PromptFreshnessStatus = 'fresh' | 'stale' | 'missing';
export type PromptStaleReason = 'hash_mismatch' | 'not_compiled' | null;

export interface ContextHashInputs {
    repoCommit: string;
    graphVersion: string;
    memorySnapshot: string;
    packetSchema: string;
    templateVersion: string;
}

export interface PromptFreshnessEvaluation {
    freshnessStatus: PromptFreshnessStatus;
    staleReason: PromptStaleReason;
    shouldInvalidateCache: boolean;
}

export interface FreshnessEvaluationInput {
    compiledPrompt: string | null | undefined;
    storedContextHash: string | null | undefined;
    currentContextHash: string;
}

export interface HashEnvironment {
    FORGEOS_REPO_COMMIT?: string;
    GIT_COMMIT_SHA?: string;
    SOURCE_COMMIT?: string;
    FORGEOS_GRAPH_VERSION?: string;
    FORGEOS_MEMORY_SNAPSHOT_VERSION?: string;
}

export function normalizeCanonicalToken(value: string): string {
    return value.trim().replace(/[|\n\r\t]/g, '_');
}

export function canonicalSerialize(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

export function computeDeterministicHash(value: unknown): string {
    return createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

export function computeContextHash(inputs: ContextHashInputs): string {
    const canonicalInputs: ContextHashInputs = {
        repoCommit: normalizeCanonicalToken(inputs.repoCommit),
        graphVersion: normalizeCanonicalToken(inputs.graphVersion),
        memorySnapshot: normalizeCanonicalToken(inputs.memorySnapshot),
        packetSchema: normalizeCanonicalToken(inputs.packetSchema),
        templateVersion: normalizeCanonicalToken(inputs.templateVersion),
    };

    return computeDeterministicHash(canonicalInputs);
}

export function buildContextHashInputsFromEnv(
    env: HashEnvironment = process.env,
    packetSchema: string,
    templateVersion: string,
): ContextHashInputs {
    const repoCommit = normalizeCanonicalToken(
        env.FORGEOS_REPO_COMMIT
        ?? env.GIT_COMMIT_SHA
        ?? env.SOURCE_COMMIT
        ?? 'unknown',
    );
    const graphVersion = normalizeCanonicalToken(env.FORGEOS_GRAPH_VERSION ?? 'unknown');
    const memorySnapshot = normalizeCanonicalToken(env.FORGEOS_MEMORY_SNAPSHOT_VERSION ?? 'unknown');

    return {
        repoCommit,
        graphVersion,
        memorySnapshot,
        packetSchema,
        templateVersion,
    };
}

export function evaluatePromptFreshness(input: FreshnessEvaluationInput): PromptFreshnessEvaluation {
    const hasCompiledPrompt = typeof input.compiledPrompt === 'string' && input.compiledPrompt.trim().length > 0;
    if (!hasCompiledPrompt) {
        return {
            freshnessStatus: 'missing',
            staleReason: 'not_compiled',
            shouldInvalidateCache: true,
        };
    }

    const stored = (input.storedContextHash ?? '').trim();
    if (stored.length === 0) {
        return {
            freshnessStatus: 'missing',
            staleReason: 'not_compiled',
            shouldInvalidateCache: true,
        };
    }

    if (stored !== input.currentContextHash) {
        return {
            freshnessStatus: 'stale',
            staleReason: 'hash_mismatch',
            shouldInvalidateCache: true,
        };
    }

    return {
        freshnessStatus: 'fresh',
        staleReason: null,
        shouldInvalidateCache: false,
    };
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => canonicalize(item));
    }

    if (value && typeof value === 'object') {
        const input = value as Record<string, unknown>;
        const keys = Object.keys(input).sort((a, b) => a.localeCompare(b));
        const output: Record<string, unknown> = {};

        for (const key of keys) {
            output[key] = canonicalize(input[key]);
        }

        return output;
    }

    return value;
}
