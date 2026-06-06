import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {Config} from './config.js';
import {ToolExecutor} from './tools.js';

function createRepository(): string {
  const repo = mkdtempSync(join(tmpdir(), 'hunter-tools-'));
  mkdirSync(join(repo, 'src', 'features'), {recursive: true});
  writeFileSync(
    join(repo, 'src', 'features', 'Example.ts'),
    'export function calculateExample(value: number) {\n  return value + 1;\n}\n',
    'utf-8',
  );
  execFileSync('git', ['init', '-q'], {cwd: repo});
  execFileSync('git', ['add', 'src/features/Example.ts'], {cwd: repo});
  execFileSync(
    'git',
    ['-c', 'user.name=Hunter Test', '-c', 'user.email=hunter@example.com', 'commit', '-qm', 'add example'],
    {cwd: repo},
  );
  return repo;
}

function config(expensifyPath: string): Config {
  return {
    openrouterApiKey: 'test',
    model: 'test',
    expensifyPath,
    expensifyBranch: 'main',
    githubToken: 'test',
    discordWebhook: '',
    pollInterval: 60,
    outputDir: join(expensifyPath, 'output'),
    maxToolIterations: 15,
    maxOutputTokens: 1024,
  };
}

test('repository tools find, search, read, and inspect historical source', async () => {
  const repo = createRepository();
  const tools = new ToolExecutor(config(repo));

  const files = await tools.execute('find_files', {pattern: 'src/**/*.ts'}, 'files');
  const search = await tools.execute('grep_search', {pattern: 'calculateExample'}, 'search');
  const read = await tools.execute('read_file', {path: 'src/features/Example.ts', startLine: 1, maxLines: 2}, 'read');
  const historical = await tools.execute(
    'git_show_file',
    {revision: 'HEAD', path: 'src/features/Example.ts', startLine: 2, maxLines: 1},
    'history',
  );

  assert.match(files.content, /src\/features\/Example\.ts/);
  assert.match(search.content, /Example\.ts:1/);
  assert.match(read.content, /export function calculateExample/);
  assert.match(historical.content, /return value \+ 1/);
});

test('read_file rejects paths outside the configured repository', async () => {
  const repo = createRepository();
  const tools = new ToolExecutor(config(repo));
  const result = await tools.execute('read_file', {path: '../outside.txt'}, 'traversal');

  assert.match(result.content, /Path traversal detected/);
});
