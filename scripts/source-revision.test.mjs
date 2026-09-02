import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { checkedOutSourceRevision } from './source-revision.mjs';

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(temporaryRepositories.splice(0).map((path) => (
    rm(path, { force: true, recursive: true })
  )));
});

describe('benchmark source revision', () => {
  it('derives the exact checked-out commit from the selected repository', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'webmcp-loom-source-revision-'));
    temporaryRepositories.push(repository);
    git(repository, 'init');
    git(repository, 'config', 'user.email', 'benchmark-test@example.invalid');
    git(repository, 'config', 'user.name', 'Benchmark Test');
    await writeFile(join(repository, 'fixture.txt'), 'bound source\n');
    git(repository, 'add', 'fixture.txt');
    git(repository, 'commit', '-m', 'test fixture');

    const expected = git(repository, 'rev-parse', 'HEAD').trim();
    expect(checkedOutSourceRevision(repository)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{40}$/);
  });

  it('fails when the selected directory has no checked-out commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'webmcp-loom-no-source-revision-'));
    temporaryRepositories.push(directory);
    expect(() => checkedOutSourceRevision(directory)).toThrow();
  });
});

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
