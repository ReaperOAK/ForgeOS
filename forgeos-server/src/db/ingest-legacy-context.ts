/**
 * Ingest legacy filesystem agent/vibecoding content into lessons + embeddings.
 *
 * This enables deleting `.github/agents` and `.github/vibecoding` while keeping
 * context searchable via pgvector memory tools.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool } from './pool.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { logger } from '../middleware/logging.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.json', '.txt']);
const MAX_CHUNK_CHARS = 1200;
const SKIP_EMBEDDING = process.env.INGEST_SKIP_EMBEDDING === '1';

interface IngestSummary {
    filesScanned: number;
    chunksInserted: number;
    chunksSkipped: number;
}

function sha(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function chunkText(text: string, maxChars: number): string[] {
    const cleaned = text.replace(/\r\n/g, '\n').trim();
    if (cleaned.length === 0) {
        return [];
    }

    const paragraphs = cleaned.split(/\n\s*\n/);
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
        const candidate = current.length > 0 ? `${current}\n\n${para}` : para;
        if (candidate.length <= maxChars) {
            current = candidate;
            continue;
        }

        if (current.length > 0) {
            chunks.push(current);
            current = '';
        }

        if (para.length <= maxChars) {
            current = para;
            continue;
        }

        // Hard split for very large paragraphs.
        for (let i = 0; i < para.length; i += maxChars) {
            chunks.push(para.slice(i, i + maxChars));
        }
    }

    if (current.length > 0) {
        chunks.push(current);
    }

    return chunks;
}

async function walkFiles(rootDir: string): Promise<string[]> {
    const results: string[] = [];

    async function walk(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTENSIONS.has(ext)) {
                results.push(full);
            }
        }
    }

    await walk(rootDir);
    return results;
}

async function upsertChunk(
    embeddingService: EmbeddingService,
    filePath: string,
    relativePath: string,
    chunkTextValue: string,
    chunkIndex: number,
    totalChunks: number,
): Promise<'inserted' | 'skipped'> {
    const fingerprint = sha(`${relativePath}:${chunkIndex}:${chunkTextValue}`);

    const exists = await pool.query<{ id: string }>(
        `SELECT id
     FROM lessons
     WHERE category = 'instruction'
       AND context->>'fingerprint' = $1
     LIMIT 1`,
        [fingerprint],
    );

    if (exists.rows.length > 0) {
        return 'skipped';
    }

    const lessonText = `[${relativePath}]\n${chunkTextValue}`;

    const insertLesson = await pool.query<{ id: string }>(
        `INSERT INTO lessons (
      ticket_id, stage, agent_role, rework_count,
      lesson_text, category, tags, context
    ) VALUES (
      $1, $2, $3, 0,
      $4, 'instruction', $5::text[], $6::jsonb
    ) RETURNING id`,
        [
            'LEGACY-CONTEXT',
            'READY',
            'Compiler',
            lessonText,
            ['instruction', 'legacy', 'filesystem'],
            JSON.stringify({
                source_file: relativePath,
                absolute_path: filePath,
                chunk_index: chunkIndex,
                total_chunks: totalChunks,
                fingerprint,
            }),
        ],
    );

    const lessonId = insertLesson.rows[0]?.id;
    if (!lessonId) {
        throw new Error(`Failed to insert lesson for ${relativePath}#${chunkIndex}`);
    }

    if (SKIP_EMBEDDING) {
        return 'inserted';
    }

    // Best effort embedding insert: do not fail ingestion if embedding infra is unavailable.
    try {
        const embedding = await Promise.race([
            embeddingService.embedText(lessonText),
            new Promise<number[]>((_, reject) => {
                setTimeout(() => reject(new Error('embedding timeout')), 8000);
            }),
        ]);

        await pool.query(
            `INSERT INTO lesson_embeddings (lesson_id, embedding, model_name)
       VALUES ($1, $2, $3)`,
            [lessonId, JSON.stringify(embedding), process.env.EMBEDDING_MODEL ?? 'mxbai-embed-large'],
        );
    } catch (err) {
        logger.warn(
            {
                relativePath,
                chunkIndex,
                error: err instanceof Error ? err.message : String(err),
            },
            'legacy-context ingest: embedding skipped for chunk',
        );
    }

    return 'inserted';
}

export async function ingestLegacyContext(): Promise<IngestSummary> {
    const configuredWorkspace = process.env.WORKSPACE_PATH?.trim();
    const isPlaceholderWorkspace = configuredWorkspace === undefined
        ? true
        : configuredWorkspace.length === 0 || configuredWorkspace.includes('/path/to/your/forgeos/repo');

    const workspaceRoot: string = !isPlaceholderWorkspace && configuredWorkspace !== undefined
        ? configuredWorkspace
        : path.resolve(process.cwd(), '..');

    const targets = [
        path.join(workspaceRoot, '.github', 'agents'),
        path.join(workspaceRoot, '.github', 'vibecoding'),
    ];

    const embeddingService = new EmbeddingService();

    const summary: IngestSummary = {
        filesScanned: 0,
        chunksInserted: 0,
        chunksSkipped: 0,
    };

    for (const target of targets) {
        try {
            await fs.access(target);
        } catch {
            logger.warn({ target }, 'legacy-context ingest: directory missing, skipping');
            continue;
        }

        const files = await walkFiles(target);
        summary.filesScanned += files.length;

        for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
            const filePath = files[fileIndex];
            if (!filePath) continue;

            if (fileIndex % 50 === 0) {
                logger.info(
                    {
                        target,
                        fileIndex,
                        totalFiles: files.length,
                        skipEmbedding: SKIP_EMBEDDING,
                    },
                    'legacy-context ingest progress',
                );
            }

            const raw = await fs.readFile(filePath, 'utf-8');
            const chunks = chunkText(raw, MAX_CHUNK_CHARS);
            const relative = path.relative(workspaceRoot, filePath);

            for (let i = 0; i < chunks.length; i += 1) {
                const outcome = await upsertChunk(
                    embeddingService,
                    filePath,
                    relative,
                    chunks[i] ?? '',
                    i,
                    chunks.length,
                );
                if (outcome === 'inserted') {
                    summary.chunksInserted += 1;
                } else {
                    summary.chunksSkipped += 1;
                }
            }
        }
    }

    logger.info(summary, 'legacy-context ingest complete');
    return summary;
}

const isDirectRun = process.argv[1]?.includes('ingest-legacy-context');
if (isDirectRun) {
    ingestLegacyContext()
        .then((result) => {
            logger.info(result, 'legacy-context ingest result');
            process.exit(0);
        })
        .catch((err) => {
            logger.error({ err }, 'legacy-context ingest failed');
            process.exit(1);
        });
}
