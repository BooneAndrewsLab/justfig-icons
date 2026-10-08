/**
 * `npm run pack`: dist/ → release/justfig-icons-<version>.tar.gz and its
 * .sha256. The tarball is reproducible (sorted names, zero mtimes and
 * owners, gzip without a timestamp), so the same build gives the same hash
 * locally and in CI; the app pins that hash in its icons.lock.json.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'manifest.json'))) throw new Error('no dist/ (npm run build)');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')) as {
  version: string;
};
if (manifest.version !== pkg.version)
  throw new Error(`dist/ is version ${manifest.version}, package.json ${pkg.version}`);

const tar = execFileSync(
  'tar',
  [
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--format=gnu',
    '-cf',
    '-',
    '-C',
    dist,
    '.',
  ],
  { maxBuffer: 1 << 30 },
);
const gz = gzipSync(tar, { level: 9 });
const out = join(root, 'release');
mkdirSync(out, { recursive: true });
const name = `justfig-icons-${pkg.version}.tar.gz`;
writeFileSync(join(out, name), gz);
const sha = createHash('sha256').update(gz).digest('hex');
writeFileSync(join(out, `${name}.sha256`), `${sha}  ${name}\n`);
console.log(`release/${name}: ${String(Math.round(gz.length / 1e6))} MB, sha256 ${sha}`);
