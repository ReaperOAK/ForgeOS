import { compileIfStale, type CompiledPromptResult } from './compiler.js';
import { PacketValidationError, validatePacketSections } from './packet-validator.js';

/**
 * Thin orchestration entrypoint for prompt compilation pipeline.
 *
 * This composes freshness-aware compilation (`compileIfStale`) with a final
 * packet schema validation guard so only structurally valid packets are
 * returned to callers.
 */
export async function orchestrateCompilePipeline(ticketId: string): Promise<CompiledPromptResult> {
    const result = await compileIfStale(ticketId);
    const validation = validatePacketSections(result.prompt);

    if (!validation.valid) {
        throw new PacketValidationError(validation);
    }

    return result;
}
