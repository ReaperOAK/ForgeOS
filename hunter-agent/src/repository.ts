import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import type {Config} from './config.js';

function git(config: Config, args: string[]): string {
  return execFileSync('git', ['-C', config.expensifyPath, ...args], {
    encoding: 'utf-8',
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  }).trim();
}

export function prepareExpensifyRepository(config: Config): void {
  const configuredPath = resolve(config.expensifyPath);
  const repositoryRoot = resolve(git(config, ['rev-parse', '--show-toplevel']));
  if (repositoryRoot !== configuredPath) {
    throw new Error(
      `EXPENSIFY_PATH must point to the Expensify repository root. Configured: ${configuredPath}; detected: ${repositoryRoot}`,
    );
  }

  const trackedChanges = git(config, ['status', '--porcelain', '--untracked-files=no']);
  if (trackedChanges) {
    throw new Error('Expensify checkout has tracked local changes; refusing to analyze a mixed source state.');
  }

  const branch = git(config, ['branch', '--show-current']);
  if (branch !== config.expensifyBranch) {
    throw new Error(
      `Expensify checkout is on "${branch || 'detached HEAD'}"; expected "${config.expensifyBranch}".`,
    );
  }

  git(config, ['fetch', '--quiet', 'origin', config.expensifyBranch]);
  git(config, ['merge', '--ff-only', `origin/${config.expensifyBranch}`]);
}
