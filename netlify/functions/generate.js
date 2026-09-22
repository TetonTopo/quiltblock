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
 * count. If it fails, the failure is handed back to the model once, in words,
 * and it tries again. If it fails twice the customer gets an error rather than
 * a pattern that does not sew.
 *
 * Deploy notes are in docs/deploying.md. Set ANTHROPIC_API_KEY in the host's
 * environment settings - never in the repo.
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildBlock, validateBlock, unitCounts } from '../../packages/pattern-core/src/index.js';

const MODEL = process.env.QUILTBLOCK_MODEL || 'claude-opus-5';
const MAX_ATTEMPTS = 2;

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
         immediately below a > or < goose

Adjacent plain cells of the same fabric are merged automatically into the
largest rectangles they form, so large flat areas cost very few pieces. Use that:
write the picture out cell by cell and let the merging do the work.

THE RULES, WHICH ARE NOT NEGOTIABLE
1. Straight lines only. Horizontal, vertical, or a true 45 degree diagonal.
   There is no token for a curve because there are no curves.
2. Flat and crayon-simple. A side-profile silhouette. No shading, no gradients,
   no attempt at three dimensions, no outlines around shapes.
3. Difficulty is piece count, not colour count. Aim for 12-30 pieces after
   merging. A big flat background is free; a checkerboard is not.
4. Readability beats detail. At arm's length the subject has to be obvious.
   Legs, ears and chimneys need to be at least one full cell wide.
5. Modern, not folksy. Solid fabrics, confident colour, plenty of negative space.

HOW TO WORK
Sketch the silhouette on the grid in your head first, deciding which rows the
subject occupies. Put the background in as one fabric so it merges. Use
half-square triangles only where a diagonal genuinely reads better than a step -
a roof, an ear, a sail, a hillside. Use flying geese for symmetrical points and
hourglasses for star centres.

Name the fabrics the way a shop would: "Madder red", "Sky blue solid",
"Oatmeal linen". Give every fabric a hex colour that a quilter could match.

Call the draft_block tool exactly once.`;

const BLOCK_TOOL = {
  name: 'draft_block',
  description: 'Submit a finished quilt block design in the grid DSL.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short pattern name, e.g. "Cow with skis".' },
      subject: { type: 'string', description: 'One-word category, e.g. Farm, Pets, Outdoors.' },
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
      rows: {
        type: 'array',
        description: 'The grid, one string per row, tokens separated by single spaces.',
        items: { type: 'string' },
      },
      notes: { type: 'string', description: 'What you simplified and why, for the customer.' },
    },
    required: ['name', 'subject', 'blurb', 'fabrics', 'accent', 'rows', 'notes'],
    additionalProperties: false,
  },
};

const json = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

let client = null;
function anthropic() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return client;
}

export async function handler(event) {
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);

  // The browser probes with GET so it can show "live" or "stand-in" honestly.
  if (event.httpMethod === 'GET') {
    return json(200, { available: configured, model: configured ? MODEL : null });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  if (!configured) return json(503, { error: 'No API key is configured on this deployment.' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body must be JSON.' });
  }

  const prompt = String(body.prompt || '').slice(0, 600).trim();
  const photo = body.photo;
  if (!prompt && !photo) return json(400, { error: 'Send a description or a photo.' });

  const gridSize = clamp(Number(body.gridSize) || 8, 4, 12);
  const fabricLimit = clamp(Number(body.fabricLimit) || 4, 2, 8);
  const blockSize = clamp(Number(body.blockSize) || 12, 6, 24);

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
      `The block finishes at ${blockSize} inches.`,
  });

  const messages = [{ role: 'user', content }];
  const attempts = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // A refusal on "draw me a cow" would be surprising, but a shop that
        // takes public input should degrade to a working model, not a 500.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [BLOCK_TOOL],
        tool_choice: { type: 'tool', name: 'draft_block' },
        messages,
      });
    } catch (err) {
      return json(err?.status === 429 ? 429 : 502, {
        error: err?.status === 429 ? 'The generator is busy. Try again in a moment.' : 'The generator failed.',
        detail: String(err?.message ?? err).slice(0, 300),
      });
    }

    if (response.stop_reason === 'refusal') {
      return json(422, {
        error: 'The model declined to design that one. Try describing it differently.',
        category: response.stop_details?.category ?? null,
      });
    }

    const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'draft_block');
    if (!call) {
      attempts.push('The model did not call draft_block.');
      continue;
    }

    const draft = call.input;
    const def = toDefinition(draft);
    const problem = checkDraft(def, { blockSize, fabricLimit });

    if (!problem) {
      const block = buildBlock(def, { blockSize });
      return json(200, {
        block: def,
        notes: draft.notes,
        stats: {
          pieces: block.pieces.length,
          units: block.units.length,
          fabrics: block.fabricsUsed.length,
          constructions: unitCounts(block),
          extraSeams: block.merges,
        },
        model: MODEL,
        attempts: attempt,
        usage: response.usage,
      });
    }

    attempts.push(problem);
    if (attempt === MAX_ATTEMPTS) break;

    // Hand the failure back in the model's own terms and let it fix the draft.
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

  return json(422, {
    error: 'The block came back breaking the rules twice, so it was not shown.',
    attempts,
  });
}

/** Tool output -> the shape `pattern-core` expects. */
function toDefinition(draft) {
  const fabrics = {};
  for (const f of draft.fabrics ?? []) {
    if (typeof f?.key === 'string' && f.key.length === 1) {
      fabrics[f.key] = { name: String(f.name ?? f.key), hex: normaliseHex(f.hex) };
    }
  }
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: String(draft.name ?? 'Custom block'),
    subject: String(draft.subject ?? 'Custom'),
    blurb: String(draft.blurb ?? ''),
    custom: true,
    accent: typeof draft.accent === 'string' ? draft.accent[0] : undefined,
    fabrics,
    rows: (draft.rows ?? []).map((r) => String(r)),
  };
}

function normaliseHex(hex) {
  const s = String(hex ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : '#888888';
}

/**
 * Build it and run the house rules. Returns a sentence describing the first
 * problem, written for the model to act on, or null if the block is good.
 */
function checkDraft(def, { blockSize, fabricLimit }) {
  let block;
  try {
    block = buildBlock(def, { blockSize });
  } catch (err) {
    return String(err.message);
  }

  const v = validateBlock(block);
  if (v.errors.length) return v.errors.map((e) => e.message).join(' ');

  if (block.fabricsUsed.length > fabricLimit) {
    return `It uses ${block.fabricsUsed.length} fabrics but the customer asked for at most ${fabricLimit}.`;
  }

  // A block that is 95% one fabric is a background with nothing on it.
  const biggest = Math.max(
    ...block.fabricsUsed.map(
      (k) => block.pieces.filter((p) => p.fabric === k).length / block.pieces.length,
    ),
  );
  if (block.pieces.length < 8 || biggest > 0.85) {
    return 'The subject does not read - it is nearly all background. Draw the shape across more of the grid.';
  }

  return null;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

export { SYSTEM, BLOCK_TOOL, checkDraft, toDefinition };
