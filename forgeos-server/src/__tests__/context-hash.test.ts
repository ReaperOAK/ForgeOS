import { describe, expect, it } from 'vitest';
import {
    buildContextHashInputsFromEnv,
    canonicalSerialize,
    computeContextHash,
    evaluatePromptFreshness,
} from '../services/context-hash.js';

describe('context-hash service', () => {
    it('produces identical hash across 100 repeated runs for identical inputs', () => {
        const inputs = {
            repoCommit: 'abc123',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'prompt-architect-v1',
        };

        const baseline = computeContextHash(inputs);
        for (let run = 0; run < 100; run += 1) {
            expect(computeContextHash(inputs)).toBe(baseline);
        }
    });

    it('changes hash when any single canonical input mutates', () => {
        const base = {
            repoCommit: 'abc123',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'prompt-architect-v1',
        };

        const baseline = computeContextHash(base);

        expect(computeContextHash({ ...base, repoCommit: 'abc124' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, graphVersion: 'g2' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, memorySnapshot: 'm2' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, packetSchema: 'v2' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, templateVersion: 'prompt-architect-v2' })).not.toBe(baseline);
    });

    it('serializes unordered objects deterministically using canonical key ordering', () => {
        const left = {
            b: { y: 2, x: 1 },
            a: [
                { z: 3, y: 2 },
                { b: true, a: false },
            ],
        };

        const right = {
            a: [
                { y: 2, z: 3 },
                { a: false, b: true },
            ],
            b: { x: 1, y: 2 },
        };

        expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
    });

    it('evaluates freshness and cache invalidation decisions correctly', () => {
        const currentHash = computeContextHash({
            repoCommit: 'abc123',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'prompt-architect-v1',
        });

        expect(
            evaluatePromptFreshness({
                compiledPrompt: 'compiled',
                storedContextHash: currentHash,
                currentContextHash: currentHash,
            }),
        ).toEqual({
            freshnessStatus: 'fresh',
            staleReason: null,
            shouldInvalidateCache: false,
        });

        expect(
            evaluatePromptFreshness({
                compiledPrompt: 'compiled',
                storedContextHash: 'different-hash',
                currentContextHash: currentHash,
            }),
        ).toEqual({
            freshnessStatus: 'stale',
            staleReason: 'hash_mismatch',
            shouldInvalidateCache: true,
        });

        expect(
            evaluatePromptFreshness({
                compiledPrompt: null,
                storedContextHash: null,
                currentContextHash: currentHash,
            }),
        ).toEqual({
            freshnessStatus: 'missing',
            staleReason: 'not_compiled',
            shouldInvalidateCache: true,
        });
    });

    it('builds canonical inputs from environment tokens with sanitization', () => {
        const inputs = buildContextHashInputsFromEnv(
            {
                FORGEOS_REPO_COMMIT: 'repo|sha\n1',
                FORGEOS_GRAPH_VERSION: 'graph\tversion',
                FORGEOS_MEMORY_SNAPSHOT_VERSION: 'memory\rversion',
            },
            'v1',
            'prompt-template-v1',
        );

        expect(inputs).toEqual({
            repoCommit: 'repo_sha_1',
            graphVersion: 'graph_version',
            memorySnapshot: 'memory_version',
            packetSchema: 'v1',
            templateVersion: 'prompt-template-v1',
        });
    });
});
