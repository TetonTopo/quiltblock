/**
 * Skill tiers - the complexity dial.
 *
 * The patterns in the pile label themselves "Beginner", "Confident Beginner",
 * "Advanced Beginner". Reading them side by side, the label tracks three
 * things: what constructions are in the block, how many pieces there are, and
 * how small they get. A charm-square kit is squares and strips. A maple leaf
 * adds half-square triangles and stitch-and-flip corners. A chicken adds
 * flying geese and one-inch pieces. A feathered star is a hundred tiny
 * triangles.
 *
 * `difficultyOf` in validate.js scores a block from its geometry; these tiers
 * turn the score into a label, and tell the generator what it may use when a
 * customer asks for a block at a given level.
 */

export const TIERS = {
  beginner: {
    id: 'beginner',
    name: 'Beginner',
    short: 'Beginner',
    maxScore: 18,
    blurb: 'Squares, rectangles and strips, with a stitch-and-flip corner or two. Nine patches, log cabins, charm squares.',
    kinds: ['patch'],
    corners: true,
    geese: false,
    grids: [3, 4, 6],
    pieces: [4, 14],
    minCell: 32,
    prompt:
      'Use plain cells only, apart from at most four half-square-triangle cells placed at the corners of a ' +
      'rectangle so they become stitch-and-flip corners. No hourglasses, no flying geese. Aim for 5 to 14 ' +
      'pieces after merging. Every piece at least 2 inches finished.',
  },
  confident: {
    id: 'confident',
    name: 'Confident beginner',
    short: 'Confident',
    maxScore: 32,
    blurb: 'Half-square triangles, flying geese and stitch-and-flip corners. Stars, pinwheels, a maple leaf.',
    kinds: ['patch', 'hst', 'geese'],
    corners: true,
    geese: true,
    grids: [4, 6, 8],
    pieces: [10, 24],
    minCell: 24,
    prompt:
      'Plain cells, half-square triangles and flying geese are all fine. No hourglasses. Aim for 12 to 24 ' +
      'pieces after merging. Nothing under 1½ inches finished.',
  },
  intermediate: {
    id: 'intermediate',
    name: 'Intermediate',
    short: 'Intermediate',
    maxScore: 52,
    blurb: 'Hourglass units, lots of triangles, finer grids. Bear paws, Dutchman’s puzzle, a chicken with a comb.',
    kinds: ['patch', 'hst', 'geese', 'qst'],
    corners: true,
    geese: true,
    grids: [6, 8, 10, 12],
    pieces: [20, 40],
    minCell: 16,
    prompt:
      'Every cell type is available, including hourglasses. Aim for 20 to 40 pieces after merging. ' +
      'Pieces may go down to 1 inch finished where the picture needs it.',
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    short: 'Advanced',
    maxScore: Infinity,
    blurb: 'Many small triangles, feathered edges, one-inch pieces. Lady of the lake, delectable mountains.',
    kinds: ['patch', 'hst', 'geese', 'qst'],
    corners: true,
    geese: true,
    grids: [8, 10, 12],
    pieces: [30, 72],
    minCell: 12,
    prompt:
      'Every cell type is available. This customer wants a challenge: aim for 30 to 70 pieces, fine detail, ' +
      'sawtooth edges of small half-square triangles where they help the picture. Pieces may go down to ¾ inch.',
  },
};

export const TIER_ORDER = ['beginner', 'confident', 'intermediate', 'advanced'];
export const DEFAULT_TIER = 'confident';

export function resolveTier(idOrTier = DEFAULT_TIER) {
  if (typeof idOrTier === 'object' && idOrTier) return idOrTier;
  const t = TIERS[idOrTier];
  if (!t) throw new RangeError(`unknown skill tier: ${idOrTier}`);
  return t;
}

/** The tier a difficulty score lands in. */
export function tierOfScore(score) {
  for (const id of TIER_ORDER) if (score <= TIERS[id].maxScore) return TIERS[id];
  return TIERS.advanced;
}

/** Validation limits for a generated block at this tier. */
export function tierLimits(tier) {
  const t = resolveTier(tier);
  return { maxPieces: t.pieces[1], comfortablePieces: t.pieces[1], minPieces: t.pieces[0], minFinished: t.minCell };
}
