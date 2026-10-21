/**
 * POST /.netlify/functions/generate
 *
 * Turns "a cow with skis on" into a block definition in the grid DSL.
 *
 * This is the only place in the project that holds an Anthropic API key, and it
 * runs on the server. The browser never sees the key, never talks to
 * api.anthropic.com, and cannot spend anything except through this endpoint.
 * That is the whole reason this file exists rather than calling the model from
 * `apps/web`.
 *
 * The model does not get the last word. Whatever comes back is built with
 * `pattern-core` and checked against the house rules - straight lines only,
 * pieces that tile the block exactly, nothing too small to sew, a sane piece
 * count - and against the skill tier the customer asked for. If it fails, the
 * failure is handed back to the model once, in words, and it tries again. If
 * it fails twice the customer gets an error rather than a pattern that does
 * not sew.
 *
 * Deploy notes are in docs/deploying.md. Set ANTHROPIC_API_KEY in the host's
 * environment settings - never in the repo.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  buildBlock,
  unitCounts,
  difficultyOf,
  TIERS,
  DEFAULT_TIER,
} from '../../packages/pattern-core/src/index.js';
import { checkDraft, toDefinition, clamp } from '../lib/draft.js';
import { limitsFromEnv, sameCode, hashIp, admit, finish, memoryStore } from '../lib/limits.js';

/** The default model. QUILTBLOCK_MODEL overrides it without a code change. */
const MODEL = 'claude-opus-5-5';
const MAX_ATTEMPTS = 2;

/**
 * Netlify stops a synchronous function at 30 seconds on the free plan (60 on
 * paid ones). QUILTBLOCK_TIME_LIMIT_S says which; four seconds are kept back
 * for start-up and the answer. A design takes about 20 seconds, so on the
 * free plan there is room for one attempt per request, and the page asks
 * again itself, with the reason, when a draft is rejected.
 */
const timeLimitMs = () => (Number(env('QUILTBLOCK_TIME_LIMIT_S')) || 30) * 1000 - 4_000;
/** Do not start a second attempt with less than this left. */
const MIN_ATTEMPT_MS = 22_000;

/** QUILTBLOCK_EFFORT picks one of these; medium is the default. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** About 4 MB of image once decoded. The page shrinks photos well below this. */
const MAX_PHOTO_BASE64 = 5_500_000;

/** Hard ceiling so a runaway request cannot run up a bill. */
const MAX_TOKENS = 8000;

const SYSTEM = `You design quilt blocks for a pattern shop. You output geometry, not pictures.

A block is a square grid of cells. Each row is a string of whitespace-separated
cell tokens, and every row has the same number of tokens as there are rows.
Fabrics are single lowercase letters.

CELL TOKENS
  k      a plain patch of fabric k
  a/b    half-square triangle, diagonal like "/": a upper-left, b lower-right
  a\\b    half-square triangle, diagonal like "\\": a upper-right, b lower-left
  a+b    hourglass: a on the top and bottom triangles, b on the left and right
  a^b    flying goose pointing up, TWO cells wide - goose fabric a, sky fabric b
  avb    flying goose pointing down, TWO cells wide
  a>b    flying goose pointing right, TWO cells tall
  a<b    flying goose pointing left, TWO cells tall
  .      continuation cell, required immediately right of a ^ or v goose and
         immediately below a > or < goose. A half-square triangle or hourglass
         can also be made bigger: follow it with "." to the right and fill the
         rows below with "." to make an n by n triangle unit.

Adjacent plain cells of the same fabric are merged automatically into the
largest rectangles they form, so large flat areas cost very few pieces. Use that:
write the picture out cell by cell and let the merging do the work.

STITCH-AND-FLIP CORNERS
A one-cell half-square triangle sitting at the corner of a rectangle, with the
rectangle's fabric on its inner side, is sewn as a stitch-and-flip corner: a
small square laid on the corner and sewn across. That is how commercial
patterns make every diagonal - a teapot is a square with its four corners
clipped, a leaf stem is a strip with two corners clipped, a roof is a strip
with a corner clipped at each end. Draw diagonals that way whenever you can:
"k/p p p k\\p" is a strip of p with both top corners cut off by k. Two corners
on one end of a strip make a flying goose; four corners on a square make an
octagon or a square on point.

THE RULES, WHICH ARE NOT NEGOTIABLE
1. Straight lines only. Horizontal, vertical, or a true 45 degree diagonal.
   There is no token for a curve because there are no curves.
2. Flat and crayon-simple. A side-profile silhouette. No shading, no gradients,
   no attempt at three dimensions, no outlines around shapes.
3. Difficulty is piece count, not colour count. A big flat background is free;
   a checkerboard is not. The customer has chosen a skill level, below, and the
   piece count has to land inside it.
4. Readability beats detail. At arm's length the subject has to be obvious.
   Legs, ears and chimneys need to be at least one full cell wide.
5. Modern, not folksy. Solid fabrics, confident colour, plenty of negative space.

HOW TO WORK
Sketch the silhouette on the grid in your head first, deciding which rows the
subject occupies. Put the background in as one fabric so it merges. Use
stitch-and-flip corners for slopes, roofs, ears, spouts and tapers. Use flying
geese for symmetrical points and hourglasses for star centres. For a
traditional geometric block, think in units: a star is four geese, four
corners and a centre; a bear paw is a pad with two claws a side.

Name the fabrics the way a shop would: "Madder red", "Sky blue solid",
"Oatmeal linen". Give every fabric a hex colour that a quilter could match.
Say which fabric is the background by naming its key.

Call the draft_block tool exactly once.`;

const BLOCK_TOOL = {
  name: 'draft_block',
  description: 'Submit a finished quilt block design in the grid DSL.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short pattern name, e.g. "Cow with skis".' },
      subject: { type: 'string', description: 'One-word category, e.g. Farm, Pets, Outdoors, Traditional.' },
      blurb: { type: 'string', description: 'One sentence a shop would put under the name.' },
      fabrics: {
        type: 'array',
        description: 'Every fabric used, in the order they should appear in the key.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The single lowercase letter used in the rows.' },
            name: { type: 'string' },
            hex: { type: 'string', description: 'A #rrggbb colour.' },
          },
          required: ['key', 'name', 'hex'],
          additionalProperties: false,
        },
      },
      accent: { type: 'string', description: 'The fabric key that should vary between blocks in a sampler quilt.' },
      background: { type: 'string', description: 'The fabric key of the background, which a quilt can rotate through a rainbow.' },
      rows: {
        type: 'array',
        description: 'The grid, one string per row, tokens separated by single spaces.',
        items: { type: 'string' },
      },
      notes: { type: 'string', description: 'What you simplified and why, for the customer.' },
    },
    required: ['name', 'subject', 'blurb', 'fabrics', 'accent', 'background', 'rows', 'notes'],
    additionalProperties: false,
  },
};

const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

/**
 * The rate-limit records live in a site-wide Blobs store. Off Netlify (the
 * local test harness) there is no Blobs, so an in-memory store stands in. On
 * Netlify a store that will not open is an error: better to refuse a request
 * than to call the model with the limits switched off.
 */
let localStore = null;
async function limitsStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: 'generator-limits', consistency: 'strong' });
  } catch (err) {
    if (globalThis.Netlify) throw err;
    localStore ??= memoryStore();
    return localStore;
  }
}

/**
 * GET  -> { available, model, needsCode } so the page can say "live" honestly.
 * POST -> { block, notes, stats, ... } or an error the page can show.
 */
export default async function handler(req, context = {}) {
  const limits = limitsFromEnv(env);
  const configured = Boolean(env('ANTHROPIC_API_KEY')) && limits.enabled;

  if (req.method === 'GET') {
    return json(200, { available: configured, model: configured ? model() : null, needsCode: Boolean(limits.accessCode) });
  }
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  if (!configured) return json(503, { error: 'No API key is configured on this deployment.' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Body must be JSON.' });
  }

  if (limits.accessCode && !sameCode(req.headers.get('x-quiltblock-code') ?? body.code, limits.accessCode)) {
    return json(401, { error: 'The generator is in testing. Enter the tester code to use it.', needsCode: true });
  }

  let store;
  let gate;
  try {
    store = await limitsStore();
    const ipHash = await hashIp(context.ip ?? req.headers.get('x-nf-client-connection-ip'), limits.salt);
    gate = await admit(store, { ipHash, limits, meta: { tier: String(body.tier ?? ''), photo: Boolean(body.photo) } });
  } catch (err) {
    console.error('rate limit store failed', err);
    return json(503, { error: 'The generator is unavailable right now. Try again shortly.' });
  }
  if (!gate.ok) return json(gate.status, { error: gate.error }, { 'retry-after': String(gate.retryAfter) });

  const result = await generateBlock(body, { client: anthropic() });
  await finish(store, gate.record, {
    status: result.status,
    attempts: result.body.attempts ?? null,
    usage: result.body.usage ?? null,
    ms: result.ms,
  });
  return json(result.status, result.body);
}

let client = null;
function anthropic() {
  // The SDK's own retries are capped at one: the deadline below is the real budget.
  if (!client) client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), maxRetries: 1 });
  return client;
}

const model = () => env('QUILTBLOCK_MODEL') || MODEL;

/** Swap in a stand-in client (tests), or null to go back to the real one. */
export function useClient(c) {
  client = c;
}

/**
 * Design one block. Exported so tools/try-generate.mjs can run the real thing
 * from a laptop with nothing deployed. Returns `{ status, body, ms }`.
 */
export async function generateBlock(body, { client, now = Date.now } = {}) {
  const started = now();
  const done = (status, out) => ({ status, body: out, ms: now() - started });

  const prompt = String(body.prompt || '').slice(0, 600).trim();
  const photo = body.photo;
  if (!prompt && !photo) return done(400, { error: 'Send a description or a photo.' });
  if (photo?.data && photo.data.length > MAX_PHOTO_BASE64) {
    return done(413, { error: 'That photo is too large. Try one under 4 MB, or a smaller crop.' });
  }

  const tier = TIERS[body.tier] ?? TIERS[DEFAULT_TIER];
  const gridSize = clamp(Number(body.gridSize) || tier.grids[1] || 8, 3, 12);
  const fabricLimit = clamp(Number(body.fabricLimit) || 4, 2, 10);
  const blockSize = clamp(Number(body.blockSize) || 12, 6, 36);
  // Low effort designs in about 19 seconds, medium in about 23; on a
  // 30-second function only low leaves room. Raise it on a paid plan.
  const effort = EFFORTS.includes(env('QUILTBLOCK_EFFORT')) ? env('QUILTBLOCK_EFFORT') : 'low';
  const deadline = timeLimitMs();
  // The page's own retry: what was wrong with the last draft, in words.
  const previous = String(body.previousProblem ?? '').slice(0, 500).trim();

  const content = [];
  if (photo?.data && /^image\/(png|jpeg|webp|gif)$/.test(photo.media_type || '')) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: photo.media_type, data: photo.data },
    });
  }
  content.push({
    type: 'text',
    text:
      `${photo ? 'Turn the photo above into a quilt block. ' : ''}` +
      `${prompt ? `The customer asked for: "${prompt}".` : ''}\n\n` +
      `Use a ${gridSize} by ${gridSize} grid. Use at most ${fabricLimit} fabrics. ` +
      `The block finishes at ${blockSize} inches, so a cell is ${(blockSize / gridSize).toFixed(2)} inches.\n\n` +
      `SKILL LEVEL: ${tier.name}. ${tier.prompt}` +
      (previous ? `\n\nAn earlier draft of this block was rejected: ${previous} Do not repeat that mistake.` : ''),
  });

  const messages = [{ role: 'user', content }];
  const attempts = [];
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const left = deadline - (now() - started);
    // A second attempt that cannot finish before the platform kills the
    // function is worse than an honest error now.
    if (attempt > 1 && left < MIN_ATTEMPT_MS) {
      attempts.push('Ran out of time for another try.');
      break;
    }

    let response;
    try {
      response = await client.beta.messages.create(
        {
          model: model(),
          max_tokens: MAX_TOKENS,
          // A refusal on "draw me a cow" would be surprising, but a shop that
          // takes public input should degrade to a working model, not a 500.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort },
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: [BLOCK_TOOL],
          // Current models do not accept a forced tool choice; the system
          // prompt asks for exactly one draft_block call and strict mode keeps
          // its arguments to the schema.
          tool_choice: { type: 'auto' },
          messages,
        },
        { timeout: Math.max(5_000, left) },
      );
    } catch (err) {
      const timedOut = /timeout|timed out/i.test(`${err?.name} ${err?.message}`);
      const status = err?.status === 429 ? 429 : timedOut ? 504 : 502;
      return done(status, {
        error:
          status === 429
            ? 'The generator is busy. Try again in a moment.'
            : timedOut
              ? 'That design took too long. Try again, or ask for a simpler block.'
              : 'The generator failed.',
        retryable: timedOut,
        detail: String(err?.message ?? err).slice(0, 300),
        attempts: attempt,
      });
    }

    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;

    if (response.stop_reason === 'refusal') {
      return done(422, {
        error: 'The model declined to design that one. Try describing it differently.',
        category: response.stop_details?.category ?? null,
        attempts: attempt,
        usage,
      });
    }

    const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'draft_block');
    if (!call) {
      attempts.push(response.stop_reason === 'max_tokens' ? 'The design ran out of room.' : 'The model did not call draft_block.');
      messages.push(
        { role: 'assistant', content: response.content },
        { role: 'user', content: 'Call the draft_block tool with the finished design.' },
      );
      continue;
    }

    const draft = call.input;
    const def = toDefinition(draft);
    const problem = checkDraft(def, { blockSize, fabricLimit, tier });

    if (!problem) {
      const block = buildBlock(def, { blockSize });
      return done(200, {
        block: def,
        notes: draft.notes,
        stats: {
          pieces: block.pieces.length,
          units: block.units.length,
          fabrics: block.fabricsUsed.length,
          constructions: unitCounts(block),
          extraSeams: block.merges,
          difficulty: difficultyOf(block),
        },
        tier: tier.id,
        model: response.model ?? model(),
        attempts: attempt,
        usage,
      });
    }

    attempts.push(problem);
    if (attempt === MAX_ATTEMPTS) break;

    // Hand the failure back in the model's own terms and let it fix the draft.
    // The history is only ever appended to, never edited.
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: `That block was rejected: ${problem}\n\nFix it and call draft_block again.`,
          },
        ],
      },
    );
  }

  return done(422, {
    error: 'The block came back breaking the rules, so it was not shown.',
    attempts,
    retryable: true,
    problem: attempts[attempts.length - 1] ?? null,
    usage,
  });
}

export { SYSTEM, BLOCK_TOOL, checkDraft, toDefinition };
