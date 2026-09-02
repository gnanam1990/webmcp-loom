import { execFileSync } from 'node:child_process';

/** Returns the exact checked-out commit so report provenance cannot be overridden. */
export function checkedOutSourceRevision(cwd = process.cwd()) {
  const revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error('Checked-out source revision must be an exact 40-character Git commit.');
  }
  return revision;
}
