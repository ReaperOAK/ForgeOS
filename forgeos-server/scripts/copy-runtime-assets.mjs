#!/usr/bin/env node

import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

async function copyDir(srcRelative, destRelative) {
    const src = path.join(root, srcRelative);
    const dest = path.join(root, destRelative);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true });
    console.log(`[copy-runtime-assets] ${srcRelative} -> ${destRelative}`);
}

async function main() {
    await copyDir('src/db/migrations', 'dist/db/migrations');
    await copyDir('src/services/parsers/grammars', 'dist/services/parsers/grammars');
    await copyDir('src/dashboard', 'dist/dashboard');
}

main().catch((error) => {
    console.error('[copy-runtime-assets] failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
