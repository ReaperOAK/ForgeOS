/**
 * Prompt Architect Service — generates self-contained execution prompts for ticket agents.
 *
 * Uses a free local LLM (Ollama) by default. Falls back to a deterministic
 * template when generation fails so orchestration can continue safely.
 *
 * @module services/prompt-architect-service
 */

// ── Public Types ─────────────────────────────────────────────────────────────

/** Structured ticket summary used by prompt generation. */
export interface PromptTicketSummary {
    ticket_id: string;
    title: string;
    description: string | null;
    type: string;
    priority: string;
    acceptance_criteria: string[];
}

/** Prior work entry extracted from ticket history. */
export interface PromptHistoryEntry {
    agent: string;
    summary: string;
    outcome: string;
    files: string[];
}

/** Context file entry to guide the solving agent's first reads. */
export interface PromptContextFile {
    path: string;
    reason: string;
}

/** Context payload fed into the prompt architect model. */
export interface PromptGenerationContext {
    ticket: PromptTicketSummary;
    history: PromptHistoryEntry[];
    learnings: string[];
    bestPractices: string[];
    contextFiles: PromptContextFile[];
    exactTask: string;
    executionSteps: string[];
    edgeCases: string[];
    nextStage: string;
    validationChecks: string[];
}

/** Result of prompt generation. */
export interface PromptGenerationResult {
    prompt: string;
    provider: 'ollama' | 'openai';
    model: string;
    usedFallback: boolean;
}

interface OllamaGenerateResponse {
    response?: string;
}

interface OpenAIChatResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/** Generates the final agent prompt with local-first model strategy. */
export class PromptArchitectService {
    private readonly provider: 'ollama' | 'openai';
    private readonly model: string;
    private readonly ollamaUrl: string;
    private readonly openaiUrl: string;
    private readonly openaiKey: string | undefined;

    constructor() {
        this.provider = process.env.PROMPT_LLM_PROVIDER === 'openai' ? 'openai' : 'ollama';
        this.model = process.env.PROMPT_LLM_MODEL ?? (this.provider === 'openai' ? 'gpt-4o-mini' : 'qwen2.5:7b-instruct');
        this.ollamaUrl = process.env.OLLAMA_GENERATE_URL ?? DEFAULT_OLLAMA_URL;
        this.openaiUrl = process.env.OPENAI_CHAT_URL ?? DEFAULT_OPENAI_URL;
        this.openaiKey = process.env.OPENAI_API_KEY;
    }

    /**
     * Generate the final agent prompt. If model generation fails, returns
     * deterministic fallback content with the required structure.
     */
    async generatePrompt(context: PromptGenerationContext): Promise<PromptGenerationResult> {
        try {
            const generated = await this.generateWithModel(context);
            const trimmed = generated.trim();
            if (trimmed.length > 0) {
                return {
                    prompt: trimmed,
                    provider: this.provider,
                    model: this.model,
                    usedFallback: false,
                };
            }
        } catch {
            // Intentionally swallowed: fallback provides deterministic output.
        }

        return {
            prompt: buildFallbackPrompt(context),
            provider: this.provider,
            model: this.model,
            usedFallback: true,
        };
    }

    private async generateWithModel(context: PromptGenerationContext): Promise<string> {
        const instruction = [
            'You are a Prompt Architect. Output ONLY the final agent prompt.',
            'Do not solve the ticket.',
            'Use the exact section order and headings provided in the template.',
            'If a section has no evidence, write: NOT FOUND — agent must investigate',
            'Be concrete and specific; avoid generic statements.',
        ].join('\n');

        const template = [
            '**ROLE**',
            '**TICKET**',
            '**HISTORY**',
            '**LEARNINGS**',
            '**BEST PRACTICES**',
            '**CONTEXT LOCATIONS**',
            '**YOUR EXACT TASK**',
            '**POST-COMPLETION**',
        ].join('\n');

        const payload = JSON.stringify(context, null, 2);
        const prompt = `${instruction}\n\nTemplate headings:\n${template}\n\nContext:\n${payload}`;

        if (this.provider === 'openai') {
            if (!this.openaiKey) {
                throw new Error('OPENAI_API_KEY is required when PROMPT_LLM_PROVIDER=openai');
            }
            const response = await fetch(this.openaiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.openaiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    temperature: 0.2,
                    messages: [
                        { role: 'system', content: instruction },
                        { role: 'user', content: `${template}\n\n${payload}` },
                    ],
                }),
            });
            if (!response.ok) {
                throw new Error(`OpenAI prompt generation failed with status ${response.status}`);
            }
            const data = (await response.json()) as OpenAIChatResponse;
            const content = data.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error('OpenAI response did not include message content');
            }
            return content;
        }

        const response = await fetch(this.ollamaUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                prompt,
                stream: false,
            }),
        });
        if (!response.ok) {
            throw new Error(`Ollama prompt generation failed with status ${response.status}`);
        }

        const data = (await response.json()) as OllamaGenerateResponse;
        if (!data.response) {
            throw new Error('Ollama response did not include generated text');
        }
        return data.response;
    }
}

function toLines(values: string[]): string[] {
    if (values.length === 0) {
        return ['NOT FOUND — agent must investigate'];
    }
    return values;
}

function roleForType(ticketType: string): string {
    switch (ticketType) {
        case 'backend':
            return 'Backend Engineer';
        case 'frontend':
            return 'Frontend Engineer';
        case 'fullstack':
            return 'Fullstack Engineer';
        case 'infra':
            return 'DevOps Engineer';
        case 'security':
            return 'Security Engineer';
        case 'docs':
            return 'Documentation Specialist';
        case 'research':
            return 'Research Analyst';
        case 'architecture':
            return 'Architect';
        case 'product':
            return 'Product Manager';
        case 'design':
            return 'UIDesigner';
        default:
            return 'Implementation Agent';
    }
}

function buildFallbackPrompt(context: PromptGenerationContext): string {
    const role = roleForType(context.ticket.type);
    const description = context.ticket.description?.trim() || 'NOT FOUND — agent must investigate';

    const historyLines = context.history.length > 0
        ? context.history.map((entry) => `- ${entry.agent}: ${entry.summary} -> ${entry.outcome}`)
        : ['- NOT FOUND — agent must investigate'];

    const modifiedFiles = context.history
        .flatMap((entry) => entry.files)
        .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);

    const contextLines = context.contextFiles.length > 0
        ? context.contextFiles.map((item, index) => `${index + 1}. ${item.path} - ${item.reason}`)
        : ['1. NOT FOUND — agent must investigate'];

    const checks = toLines(context.validationChecks).map((check) => `- ${check}`).join('\n');

    return [
        '**ROLE**',
        `You are a ${role}. You have full access to relevant ForgeOS MCP tools.`,
        '',
        '**TICKET**',
        `You are solving: ${context.ticket.title}`,
        `Ticket ID: ${context.ticket.ticket_id} | Priority: ${context.ticket.priority}`,
        `Goal: ${description}`,
        'Acceptance criteria:',
        ...toLines(context.ticket.acceptance_criteria).map((item) => `- ${item}`),
        '',
        '**HISTORY**',
        'Previous agents worked on this. Here\'s what happened:',
        ...historyLines,
        `- Files they modified: ${modifiedFiles.length > 0 ? modifiedFiles.join(', ') : 'NOT FOUND — agent must investigate'}`,
        '- Why it\'s incomplete: NOT FOUND — agent must investigate',
        '',
        '**LEARNINGS**',
        ...toLines(context.learnings).map((item) => `- ${item}`),
        '',
        '**BEST PRACTICES**',
        ...toLines(context.bestPractices).map((item) => `- ${item}`),
        '',
        '**CONTEXT LOCATIONS**',
        'Start by reading these files:',
        ...contextLines,
        'Also check: NOT FOUND — agent must investigate',
        '',
        '**YOUR EXACT TASK**',
        context.exactTask,
        '',
        'Do it this way:',
        ...toLines(context.executionSteps).map((item, index) => `${index + 1}. ${item}`),
        '',
        'Edge cases to handle:',
        ...toLines(context.edgeCases).map((item) => `- ${item}`),
        '',
        '**POST-COMPLETION**',
        'After you finish:',
        '1. Store learnings to memory: Append lesson summaries to the ticket metadata memory section.',
        `2. Advance ticket to: ${context.nextStage}`,
        '3. Notify: ForgeOS dispatcher/event stream',
        `4. Run: ${checks.replace(/^- /gm, '').split('\n').join(', ')}`,
    ].join('\n');
}
