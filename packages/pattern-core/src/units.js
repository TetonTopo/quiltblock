/**
 * Every length in this library is an integer number of SIXTEENTHS of an inch.
 *
 * Sixteenths, not eighths: a 1/8" seam allowance for miniature blocks still has
 * to survive being halved by the quarter-square-triangle math, and quilters
 * read 1/16" on a good ruler. Integers mean no floating point drift ever shows
 * up in a cut size, which is the one number a customer types into a rotary cut.
 */

export const U = 16; // sixteenths per inch
export const EIGHTH = 2; // sixteenths per eighth of an inch

/** Inches (may be fractional) -> sixteenths. Throws if it isn't a clean 1/16. */
export function inches(n) {
  const s = n * U;
  const r = Math.round(s);
  if (Math.abs(s - r) > 1e-9) {
    throw new RangeError(`${n}" is not a whole number of sixteenths`);
  }
  return r;
}

/** Sixteenths -> inches as a float. Only for geometry/SVG, never for cut sizes. */
export const toInches = (s) => s / U;

const VULGAR = {
  '1/2': '½',
  '1/4': '¼',
  '3/4': '¾',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};

/**
 * Sixteenths -> the way it would be printed on a cutting list: `3 1/2"` shown
 * as `3½"`. Sixteenths that have no vulgar glyph fall back to `5⁄16`.
 */
export function fmt(s, { unit = '"' } = {}) {
  const neg = s < 0 ? '-' : '';
  s = Math.abs(s);
  const whole = Math.floor(s / U);
  let num = s % U;
  let den = U;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  if (num === 0) return `${neg}${whole}${unit}`;
  const frac = VULGAR[`${num}/${den}`] ?? `${num}⁄${den}`;
  const glyph = VULGAR[`${num}/${den}`];
  if (whole === 0) return `${neg}${frac}${unit}`;
  // `3½"` reads better than `3 ½"`; `3 5⁄16"` needs the space to stay legible.
  return glyph ? `${neg}${whole}${frac}${unit}` : `${neg}${whole} ${frac}${unit}`;
}

/** `12" x 3½"` for a cutting list. */
export const fmtSize = (w, h) => `${fmt(w)} × ${fmt(h)}`;

/** Round up to the next whole eighth of an inch - how rulers are marked. */
export const ceilEighth = (s) => Math.ceil(s / EIGHTH) * EIGHTH;

/** Spreadsheet-style column labels: A, B, ... Z, AA, AB. */
export function label(i) {
  let out = '';
  i += 1;
  while (i > 0) {
    out = String.fromCharCode(65 + ((i - 1) % 26)) + out;
    i = Math.floor((i - 1) / 26);
  }
  return out;
}

/** Perceptual lightness of a #rrggbb colour, 0-255. Used to pick seam direction. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

export const isDark = (hex) => luminance(hex) < 140;
