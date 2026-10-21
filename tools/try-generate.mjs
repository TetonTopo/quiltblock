/**
 * Try the real generator from this machine - nothing deployed, no rate limits.
 *
 *   node tools/try-generate.mjs "a cow with skis on"
 *   node tools/try-generate.mjs "her cat Biscuit" photo.jpg --tier intermediate
 *   node tools/try-generate.mjs --photo C:\path\quilt.jpg --fabrics 5 --grid 10
 *
 * Needs ANTHROPIC_API_KEY, either in the environment or in a .env file at the
 * repo root (gitignored). Every run calls the API and costs money - the cost
 * of each run is printed at the end.
 *
 * Or test the deployed site instead, with no key on this machine at all:
 *
 *   node tools/try-generate.mjs "a cow" --live --code <tester code>
 *   node tools/try-generate.mjs photo.jpg --live https://deploy-preview-1--quiltblock.netlify.app
 *
 * --live sends the request to the site (default https://quiltblock.netlify.app)
 * through its rate limits and tester code (--code, or QUILTBLOCK_CODE).
 *
 * It writes the result next to the photo (or in the current folder):
 * <name>.json, the block definition, and <name>.svg, the drawing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A tiny .env reader, so there is nothing else to install.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};
const liveIndex = args.indexOf('--live');
let live = null;
if (liveIndex !== -1) {
  const next = args[liveIndex + 1];
  const hasUrl = next && /^https?:\/\//.test(next);
  live = hasUrl ? next.replace(/\/$/, '') : 'https://quiltblock.netlify.app';
  args.splice(liveIndex, hasUrl ? 2 : 1);
}
const code = flag('code', process.env.QUILTBLOCK_CODE ?? '');
const tier = flag('tier', 'confident');
const fabricLimit = Number(flag('fabrics', 4));
const gridSize = Number(flag('grid', 0)) || undefined;
const blockSize = Number(flag('size', 12));
let photoPath = flag('photo', null);
const rest = args.filter((a) => !a.startsWith('--'));
if (!photoPath && rest.length > 1 && /\.(jpe?g|png|webp|gif)$/i.test(rest[1])) photoPath = rest[1];
const prompt = rest[0] && !/\.(jpe?g|png|webp|gif)$/i.test(rest[0]) ? rest[0] : '';
if (!photoPath && /\.(jpe?g|png|webp|gif)$/i.test(rest[0] ?? '')) photoPath = rest[0];

if (!live && !process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY first (or put it in .env at the repo root).');
  process.exit(1);
}
if (!prompt && !photoPath) {
  console.error('Usage: node tools/try-generate.mjs "a description" [photo.jpg] [--tier beginner|confident|intermediate|advanced] [--fabrics 4] [--grid 8] [--size 12]');
  process.exit(1);
}

let photo = null;
if (photoPath) {
  const bytes = fs.readFileSync(photoPath);
  const ext = path.extname(photoPath).slice(1).toLowerCase().replace('jpg', 'jpeg');
  photo = { media_type: `image/${ext}`, data: bytes.toString('base64') };
  if (bytes.length > 4_000_000) {
    console.warn(`That photo is ${(bytes.length / 1e6).toFixed(1)} MB. The website shrinks photos before sending; here, crop or resize it under 4 MB.`);
  }
}

const { makePattern } = await import('../packages/pattern-core/src/index.js');

console.log(`Designing ${prompt ? `"${prompt}"` : ''}${photo ? ` from ${path.basename(photoPath)}` : ''} at ${tier}${live ? ` on ${live}` : ' locally'}...`);
let r;
if (live) {
  const started = Date.now();
  const res = await fetch(`${live}/.netlify/functions/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(code ? { 'x-quiltblock-code': code } : {}) },
    body: JSON.stringify({ prompt, photo, tier, fabricLimit, gridSize, blockSize }),
  });
  const body = await res.json().catch(() => ({ error: `The site returned ${res.status} with no JSON.` }));
  r = { status: res.status, body, ms: Date.now() - started };
  if (res.status === 429) console.error(`Rate limited; retry after ${res.headers.get('retry-after')}s.`);
} else {
  const { generateBlock } = await import('../netlify/functions/generate.js');
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  r = await generateBlock(
    { prompt, photo, tier, fabricLimit, gridSize, blockSize },
    { client: new Anthropic({ maxRetries: 1 }) },
  );
}

const u = r.body.usage ?? { input_tokens: 0, output_tokens: 0 };
// Claude Opus 5.5 list prices, per million tokens. Cache reads are cheaper,
// so this is an upper bound.
const cost = (u.input_tokens * 4 + u.output_tokens * 20) / 1e6;
console.log(`${r.status} in ${(r.ms / 1000).toFixed(1)}s · ${u.input_tokens} in / ${u.output_tokens} out tokens · about $${cost.toFixed(3)}`);
if (r.ms > 50_000) console.warn('That is close to the 60-second limit on the live site. Try QUILTBLOCK_EFFORT=low.');

if (r.status !== 200) {
  console.error(r.body.error);
  for (const a of [].concat(r.body.attempts ?? [])) console.error(`  - ${a}`);
  if (r.body.detail) console.error(`  ${r.body.detail}`);
  // Not process.exit(): on Windows that can trip over a closing socket.
  process.exitCode = 2;
} else {
  const def = r.body.block;
  const p = makePattern(def, { blockSize });
  const base = path.join(photoPath ? path.dirname(photoPath) : process.cwd(), def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  fs.writeFileSync(`${base}.json`, JSON.stringify(def, null, 2));
  fs.writeFileSync(`${base}.svg`, p.svg({ scale: 3 }));
  console.log(`${def.name}: ${p.block.pieces.length} pieces, ${p.difficulty.level}, ${r.body.attempts} attempt(s)`);
  console.log(def.rows.join('\n'));
  if (r.body.notes) console.log(`\nNotes: ${r.body.notes}`);
  console.log(`\nWrote ${base}.json and ${base}.svg`);
}
