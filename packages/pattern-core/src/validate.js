/**
 * The house rules, in code.
 *
 * These came from a quilter, not from a spec: straight lines only, a quarter
 * inch on every side, every piece labelled with its cut size, flat and
 * crayon-simple, and difficulty measured in pieces rather than colours.
 * `netlify/functions/generate.js` runs every draft through this before anyone
 * is allowed to see it, which is what stops a language model from cheerfully
 * inventing a curve.
 */

import { fmt } from './units.js';
import { seamMath } from './seams.js';
import { tierOfScore } from './tiers.js';

export const LIMITS = {
  maxFabrics: 8,
  maxFabricsHard: 50,
  /** The advanced tier lives up near this; a feathered star is 70-odd pieces. */
  maxPieces: 80,
  comfortablePieces: 30,
  minPieces: 8,
  /** Anything under 3/4" finished is miserable to sew and worse to press. */
  minFinished: 12,
};

const isStraight = (a, b) => {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx === 0 || dy === 0 || dx === dy;
};

export function validateBlock(block, { seam, trim, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const errors = [];
  const warnings = [];
  const math = seamMath(seam, trim);

  // --- straight lines only -------------------------------------------------
  for (const p of block.pieces) {
    for (let i = 0; i < p.polygon.length; i++) {
      const a = p.polygon[i];
      const b = p.polygon[(i + 1) % p.polygon.length];
      if (!isStraight(a, b)) {
        errors.push({
          rule: 'straight-lines',
          message: `Piece ${p.label} has an edge that is not horizontal, vertical or a true 45° diagonal.`,
        });
        break;
      }
    }
  }

  // --- the pieces must exactly fill the block ------------------------------
  const area = block.pieces.reduce((sum, p) => sum + polygonArea(p.polygon), 0);
  const expected = block.size * block.size;
  if (Math.abs(area - expected) > 1) {
    errors.push({
      rule: 'covers-block',
      message:
        `The pieces cover ${(area / expected * 100).toFixed(1)}% of the block. ` +
        `They have to add up to exactly ${block.blockSize}" square with no gaps or overlaps.`,
    });
  }

  // --- fabrics -------------------------------------------------------------
  const fabricCount = block.fabricsUsed.length;
  if (fabricCount > L.maxFabricsHard) {
    errors.push({ rule: 'fabrics', message: `${fabricCount} fabrics is past the ${L.maxFabricsHard}-fabric ceiling.` });
  } else if (fabricCount > L.maxFabrics) {
    warnings.push({
      rule: 'fabrics',
      message: `${fabricCount} fabrics. Over ${L.maxFabrics} starts to look busy and costs more to shop for.`,
    });
  }
  for (const key of Object.keys(block.fabrics ?? {})) {
    if (!block.fabricsUsed.includes(key)) {
      warnings.push({ rule: 'fabrics', message: `Fabric "${key}" is defined but never used.` });
    }
  }

  // --- piece count is the difficulty dial ----------------------------------
  const n = block.pieces.length;
  if (n > L.maxPieces) {
    errors.push({ rule: 'pieces', message: `${n} pieces is past the ${L.maxPieces}-piece ceiling for one block.` });
  } else if (n > L.comfortablePieces) {
    warnings.push({
      rule: 'pieces',
      message: `${n} pieces. Over ${L.comfortablePieces} this stops being a relaxing evening.`,
    });
  }
  if (n < L.minPieces) {
    warnings.push({ rule: 'pieces', message: `Only ${n} pieces - the subject may not read at all.` });
  }

  // --- nothing too small to sew -------------------------------------------
  for (const u of block.units) {
    const small = Math.min(u.w, u.h, ...(u.corners ?? []).map((k) => k.size));
    if (small < L.minFinished) {
      errors.push({
        rule: 'min-size',
        message: `A unit finishes at ${fmt(small)}, under the ${fmt(L.minFinished)} minimum. Merge it into a neighbour.`,
      });
      break;
    }
  }

  // --- every piece labelled, every cut size printable ----------------------
  const seen = new Set();
  for (const p of block.pieces) {
    if (!p.label) errors.push({ rule: 'labels', message: 'A piece has no label.' });
    if (seen.has(p.label)) errors.push({ rule: 'labels', message: `Label ${p.label} is used twice.` });
    seen.add(p.label);
  }
  for (const u of block.units) {
    const cut = u.kind === 'patch' ? math.patch(u.w, u.h) : { w: math.hstSquare(Math.min(u.w, u.h)), h: 0 };
    if (cut.w <= 0) {
      errors.push({ rule: 'cut-size', message: `A unit produced a cut size of ${fmt(cut.w)}.` });
      break;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      pieces: n,
      units: block.units.length,
      fabrics: fabricCount,
      difficulty: difficultyOf(block),
    },
  };
}

/** Shoelace formula. Polygons here are always simple and convex. */
function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Difficulty is piece count plus a penalty for bias edges, because triangles
 * stretch and squares don't. A 20-piece block of squares is a beginner block;
 * a 20-piece block that is all half-square triangles is not. A stitch-and-flip
 * corner is a bias seam on a stable base, so it costs a third of a triangle.
 * Small pieces cost extra too: an inch-wide strip is fiddlier than a four-inch one.
 */
export function difficultyOf(block) {
  const triangles = block.units.filter((u) => u.kind !== 'patch').length;
  const corners = block.units.reduce((s, u) => s + (u.corners?.length ?? 0), 0);
  const tiny = block.units.filter((u) => Math.min(u.w, u.h) < 24).length; // under 1½"
  const score = block.pieces.length + triangles * 1.5 + corners * 0.5 + tiny * 0.5;
  const tier = tierOfScore(score);
  return { level: tier.name, tier: tier.id, score };
}

export { polygonArea };
