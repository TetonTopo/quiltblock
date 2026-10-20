/**
 * What the generator does with a draft once the model hands it back: turn the
 * tool output into a block definition, then decide whether it may be shown.
 *
 * This lives outside `generate.js` so it can be tested without the Anthropic
 * SDK or an API key - it is pure pattern-core from here down. It also sits
 * outside `netlify/functions/`, where every file would be deployed as its own
 * endpoint.
 */

import {
  buildBlock,
  validateBlock,
  unitCounts,
  difficultyOf,
  tierLimits,
  TIER_ORDER,
} from '../../packages/pattern-core/src/index.js';

/** Tool output -> the shape `pattern-core` expects. */
export function toDefinition(draft) {
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
    background: typeof draft.background === 'string' ? draft.background[0] : undefined,
    fabrics,
    rows: (draft.rows ?? []).map((r) => String(r)),
  };
}

export function normaliseHex(hex) {
  const s = String(hex ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : '#888888';
}

/**
 * Build it and run the house rules, plus the tier's own limits. Returns a
 * sentence describing the first problem, written for the model to act on, or
 * null if the block is good.
 */
export function checkDraft(def, { blockSize, fabricLimit, tier }) {
  let block;
  try {
    block = buildBlock(def, { blockSize });
  } catch (err) {
    return String(err.message);
  }

  const limits = tier ? tierLimits(tier) : {};
  const v = validateBlock(block, { limits });
  if (v.errors.length) return v.errors.map((e) => e.message).join(' ');

  if (block.fabricsUsed.length > fabricLimit) {
    return `It uses ${block.fabricsUsed.length} fabrics but the customer asked for at most ${fabricLimit}.`;
  }

  if (tier) {
    const counts = unitCounts(block);
    if (!tier.geese && counts.geese) return `The ${tier.name} level does not use flying geese; draw those points as stitch-and-flip corners or leave them out.`;
    if (!tier.kinds.includes('qst') && counts.qst) return `The ${tier.name} level does not use hourglass units.`;
    if (!tier.kinds.includes('hst') && counts.hst) {
      return `The ${tier.name} level does not use half-square triangles except as stitch-and-flip corners on a rectangle. Move each diagonal to the corner of a run of plain cells of the same fabric, or remove it.`;
    }
    const d = difficultyOf(block);
    if (TIER_ORDER.indexOf(d.tier) > TIER_ORDER.indexOf(tier.id)) {
      return `It scores as ${d.level} (${block.pieces.length} pieces) but the customer asked for ${tier.name}. Simplify: merge small pieces, drop detail, use fewer triangles.`;
    }
    if (TIER_ORDER.indexOf(d.tier) < TIER_ORDER.indexOf(tier.id) - 1) {
      return `It scores as ${d.level} (${block.pieces.length} pieces) but the customer asked for ${tier.name} and wants more of a challenge. Add detail: more pieces, sawtooth edges, a finer grid.`;
    }
  }

  // A block that is 95% one fabric is a background with nothing on it.
  const biggest = Math.max(
    ...block.fabricsUsed.map(
      (k) => block.pieces.filter((p) => p.fabric === k).length / block.pieces.length,
    ),
  );
  if (block.pieces.length < 5 || biggest > 0.85) {
    return 'The subject does not read - it is nearly all background. Draw the shape across more of the grid.';
  }

  return null;
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
