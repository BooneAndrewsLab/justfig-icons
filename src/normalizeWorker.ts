/** Worker thread: normalises batches of SVG files (build.ts runs a pool of these). */
import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';

import { type NormalizeOptions, type NormalizeResult, normalizeSvg } from './normalize.ts';

export interface Job {
  readonly n: number;
  readonly file: string;
  readonly opts: NormalizeOptions;
}
export interface Done {
  readonly n: number;
  readonly result: NormalizeResult;
}

parentPort?.on('message', (jobs: readonly Job[]) => {
  const out: Done[] = jobs.map((j) => {
    let text: string;
    try {
      text = readFileSync(j.file, 'utf8');
    } catch (e: unknown) {
      return { n: j.n, result: { ok: false, reason: `unreadable file: ${String(e)}` } };
    }
    return { n: j.n, result: normalizeSvg(text, j.opts) };
  });
  parentPort?.postMessage(out);
});
