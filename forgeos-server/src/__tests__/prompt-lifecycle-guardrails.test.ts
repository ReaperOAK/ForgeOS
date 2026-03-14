import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const compilerPath = resolve(process.cwd(), 'src/services/compiler.ts');
const claimPath = resolve(process.cwd(), 'src/tools/tickets-claim.ts');
const reconciliationPath = resolve(process.cwd(), 'src/webhooks/reconciliation.ts');

function readModule(path: string): string {
    return readFileSync(path, 'utf8');
}

describe('prompt lifecycle guardrails', () => {
    it('does not reference forbidden filesystem ticket state paths', () => {
        const modules = [
            readModule(compilerPath),
            readModule(claimPath),
            readModule(reconciliationPath),
        ];

        for (const code of modules) {
            expect(code).not.toContain('.github/ticket-state');
            expect(code).not.toContain('.github/tickets');
        }
    });

    it('keeps compile triggers independent from direct filesystem state operations', () => {
        const compiler = readModule(compilerPath);
        const claim = readModule(claimPath);
        const reconciliation = readModule(reconciliationPath);

        for (const code of [compiler, claim, reconciliation]) {
            expect(code).not.toMatch(/from\s+['"]node:fs['"]/);
            expect(code).not.toMatch(/from\s+['"]fs['"]/);
            expect(code).not.toMatch(/writeFileSync|appendFileSync|mkdirSync|rmSync/);
        }
    });

    it('uses queue-based prompt compilation hooks in lifecycle entry points', () => {
        const claim = readModule(claimPath);
        const reconciliation = readModule(reconciliationPath);

        expect(claim).toContain('queueCompileTicketPrompt(ticket_id, trigger)');
        expect(claim).toContain("'claim-stale-compiled-prompt'");
        expect(claim).toContain("'claim-missing-compiled-prompt'");
        expect(reconciliation).toContain('queueCompileTicketPrompt(ticketId, `transition:${newStage}:${newStatus}`)');
    });
});
