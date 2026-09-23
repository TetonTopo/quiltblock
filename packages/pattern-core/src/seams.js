/**
 * Seam allowances, and the cut-size math that falls out of them.
 *
 * Quilters memorise three numbers: add 1/2" to a patch, add 7/8" to a
 * half-square triangle, add 1 1/4" to a quarter-square triangle. Those are not
 * magic - they are what the formulas below produce at a 1/4" seam allowance
 * with the classic trim margin. Deriving them means a 1/8" seam for a doll
 * quilt or a 1/2" seam for heirloom work gets correct numbers of its own
 * instead of the 1/4" ones with a wrong label.
 */

import { EIGHTH, ceilEighth, fmt } from './units.js';

/**
 * A triangle's seam allowance runs along a bias edge, so it has to be measured
 * perpendicular to a 45-degree line: sqrt(2) times the allowance, at each of
 * the two corners the cut square contributes. Rounded up to a ruler marking.
 *
 *   1/4" seam -> 2 * 0.25 * 1.4142 = 0.707" -> rounds up to 3/4"
 *
 * The familiar 7/8" is this plus the classic 1/8" trim margin below.
 */
function diagonalExtra(allowance) {
  return ceilEighth(2 * allowance * Math.SQRT2);
}

export const SEAM_PROFILES = {
  'scant-quarter': {
    id: 'scant-quarter',
    name: 'Scant ¼"',
    allowance: 4,
    blurb: 'Cut at ¼", sew a thread’s width inside it.',
    note:
      'Cut sizes are identical to a true ¼" seam. Sewing one thread inside ' +
      'the line gives back the fabric the fold takes up, so the block finishes ' +
      'at its stated size instead of a hair small. This is what most modern ' +
      'piecing patterns assume.',
    recommended: true,
  },
  quarter: {
    id: 'quarter',
    name: 'True ¼"',
    allowance: 4,
    blurb: 'The traditional patchwork allowance.',
    note:
      'Blocks can finish up to 1/8" small across a row of many seams, because ' +
      'each fold eats a thread or two. Sew a test unit and measure it before ' +
      'cutting a whole quilt.',
  },
  eighth: {
    id: 'eighth',
    name: '⅛"',
    allowance: 2,
    blurb: 'Miniature and doll-quilt scale.',
    note:
      'Only for small piecing in tightly woven cotton. There is very little to ' +
      'grab, and nothing to trim back if a unit comes up short. Shorten the ' +
      'stitch length.',
  },
  'three-eighths': {
    id: 'three-eighths',
    name: '⅜"',
    allowance: 6,
    blurb: 'Extra margin on loose weaves.',
    note:
      'Useful for linen, flannel and anything that frays. Pressing gets bulky - ' +
      'press open wherever four seams meet.',
  },
  half: {
    id: 'half',
    name: '½"',
    allowance: 8,
    blurb: 'Heirloom and utility quilts.',
    note:
      'Generous and very forgiving, but every seam carries real bulk. Expect to ' +
      'press most seams open.',
  },
};

export const DEFAULT_SEAM = 'scant-quarter';

/**
 * How much extra goes on a triangle unit so it can be squared up after
 * pressing. `classic` is what published patterns print.
 */
export const TRIM_STYLES = {
  tight: {
    id: 'tight',
    name: 'Cut exact',
    extra: 0,
    blurb: 'The bare geometry, rounded up to a ruler mark. No squaring up.',
  },
  classic: {
    id: 'classic',
    name: 'Classic',
    extra: EIGHTH,
    blurb: 'The familiar +⅞" half-square triangle. Light trim.',
    recommended: true,
  },
  oversize: {
    id: 'oversize',
    name: 'Oversize & trim',
    extra: EIGHTH * 4,
    blurb: 'Cut ½" bigger and square every unit up. Best accuracy, most waste.',
  },
};

export const DEFAULT_TRIM = 'classic';

export function resolveSeam(idOrProfile = DEFAULT_SEAM) {
  if (typeof idOrProfile === 'object' && idOrProfile) return idOrProfile;
  const p = SEAM_PROFILES[idOrProfile];
  if (!p) throw new RangeError(`unknown seam profile: ${idOrProfile}`);
  return p;
}

export function resolveTrim(idOrStyle = DEFAULT_TRIM) {
  if (typeof idOrStyle === 'object' && idOrStyle) return idOrStyle;
  const t = TRIM_STYLES[idOrStyle];
  if (!t) throw new RangeError(`unknown trim style: ${idOrStyle}`);
  return t;
}

/**
 * Cut sizes. Every function takes and returns sixteenths, and `finished`
 * always means the size the piece will be once it is sewn on all sides.
 */
export function seamMath(seamId = DEFAULT_SEAM, trimId = DEFAULT_TRIM) {
  const seam = resolveSeam(seamId);
  const trim = resolveTrim(trimId);
  const a = seam.allowance;
  const diag = diagonalExtra(a) + trim.extra;

  return {
    seam,
    trim,
    allowance: a,

    /** What a triangle unit gains over its finished size. 7/8" at the defaults. */
    diagonalAllowance: diag,

    /** A plain rectangle: allowance on all four sides. */
    patch: (fw, fh) => ({ w: fw + 2 * a, h: fh + 2 * a }),

    /**
     * Half-square triangles, two at a time. Cut one square of each fabric,
     * draw the diagonal, sew a seam either side of it, cut apart -> 2 units.
     */
    hstSquare: (finishedLeg) => finishedLeg + diag,
    hstPerPair: 2,

    /**
     * Quarter-square triangles (hourglass). One square of each fabric makes two
     * half-square triangles; crossing those two on the opposite diagonal and
     * cutting them apart yields two hourglass units. 1 1/4" at the defaults.
     */
    qstSquare: (finishedSide) => finishedSide + diag + 3 * EIGHTH,
    qstPerPair: 2,

    /**
     * No-waste flying geese: one large square (the goose) and four small
     * squares (the sky) yield four identical units.
     */
    geeseLarge: (finishedW) => finishedW + diag + 3 * EIGHTH,
    geeseSmall: (finishedH) => finishedH + diag,
    geesePerSet: 4,

    /**
     * Stitch-and-flip corners: the square you lay on the corner is the
     * finished corner leg plus an allowance each side, same as a patch. The
     * seam runs corner to corner, so there is nothing diagonal to add.
     */
    flipSquare: (finishedLeg) => finishedLeg + 2 * a,

    /** Strip piecing: strips are cut the finished height plus two allowances. */
    stripWidth: (finishedH) => finishedH + 2 * a,
    subcut: (finishedW) => finishedW + 2 * a,

    /**
     * Foundation paper piecing trims after sewing, so pieces are rough-cut with
     * a generous margin rather than to an exact size.
     */
    fppMargin: 2 * a + EIGHTH * 2,

    describe() {
      return (
        `${seam.name} seam, ${trim.name.toLowerCase()} · ` +
        `patch +${fmt(2 * a)} · HST +${fmt(diag)} · QST +${fmt(diag + 3 * EIGHTH)}`
      );
    },
  };
}

export { diagonalExtra };
