/**
 * Fetch rules (plan §3): git sources are fetched at their pinned commit,
 * shallow and sparse, into `raw/<id>/` (gitignored). The fetched files are
 * data: nothing in them is ever executed. `raw/<id>/.justfig-fetch.json`
 * records the URL, commit and time of the fetch.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SourceConfig } from './config.ts';

export interface FetchRecord {
  readonly url: string;
  readonly commit: string;
  readonly fetchedAt: string;
}

export const RECORD = '.justfig-fetch.json';

export function rawDir(root: string, id: string): string {
  return join(root, 'raw', id);
}

export function readFetchRecord(dir: string): FetchRecord | null {
  const p = join(dir, RECORD);
  if (!existsSync(p)) return null;
  const v = JSON.parse(readFileSync(p, 'utf8')) as Partial<FetchRecord>;
  if (typeof v.url !== 'string' || typeof v.commit !== 'string' || typeof v.fetchedAt !== 'string')
    return null;
  return { url: v.url, commit: v.commit, fetchedAt: v.fetchedAt };
}

const git = (dir: string, args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // No hooks, no credential prompts: an anonymous, read-only fetch.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();

/** Fetches one git source at its pinned commit; a no-op when already there. */
export function fetchSource(
  root: string,
  src: SourceConfig,
  log = console.log,
): FetchRecord | null {
  const f = src.fetch;
  if (f.method !== 'git') return null;
  const dir = rawDir(root, src.id);
  const have = readFetchRecord(dir);
  if (have?.commit === f.commit && have.url === f.url) {
    log(`${src.id}: already at ${f.commit.slice(0, 10)}`);
    return have;
  }
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, '.git'))) {
    git(dir, ['init', '-q']);
    git(dir, ['config', 'core.hooksPath', '/dev/null']);
    git(dir, ['remote', 'add', 'origin', f.url]);
  } else {
    git(dir, ['remote', 'set-url', 'origin', f.url]);
  }
  if (f.paths.length > 0) {
    git(dir, ['config', 'core.sparseCheckout', 'true']);
    git(dir, ['sparse-checkout', 'set', '--no-cone', ...f.paths.map((p) => `/${p}`)]);
  }
  log(`${src.id}: fetching ${f.url} @ ${f.commit.slice(0, 10)}…`);
  git(dir, ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', f.commit]);
  git(dir, ['checkout', '-q', '--detach', 'FETCH_HEAD']);
  const head = git(dir, ['rev-parse', 'HEAD']);
  if (head !== f.commit) throw new Error(`${src.id}: fetched ${head}, expected ${f.commit}`);
  const rec: FetchRecord = { url: f.url, commit: f.commit, fetchedAt: new Date().toISOString() };
  writeFileSync(join(dir, RECORD), `${JSON.stringify(rec, null, 2)}\n`);
  return rec;
}
