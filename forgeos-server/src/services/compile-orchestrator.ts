import { compileIfStale, type CompiledPromptResult } from './compiler.js';
import { PacketValidationError, validatePacketSections } from './packet-validator.js';

/**
 * Runs the compile pipeline for a ticket with freshness gating and final
 * packet schema validation.
 *
 * Calls `compileIfStale(ticketId)` to reuse a cached prompt when the context
 * hash is unchanged, or to recompile and persist when the prompt is stale or
 * missing. After compile/cache resolution, it validates the returned prompt
 * structure and rejects invalid packets.
 *
 * @param ticketId - Unique ticket identifier used to compile or load a prompt.
 * @returns The compiled prompt result when compilation/cache resolution and
 * schema validation both succeed.
 * @throws {PacketValidationError} When prompt sections are missing, empty, or
 * out of canonical order.
 */
export async function orchestrateCompilePipeline(ticketId: string): Promise<CompiledPromptResult> {
    const result = await compileIfStale(ticketId);
    const validation = validatePacketSections(result.prompt);

    if (!validation.valid) {
        throw new PacketValidationError(validation);
    }

    return result;
}
