/**
 * The block model: a grid of cells parsed into pieced UNITS.
 *
 * A unit is a thing you sew at the machine as one sub-assembly before it joins
 * the rest of the block - a plain patch, a half-square triangle, an hourglass,
 * a flying goose, or a patch with stitch-and-flip corners. Units matter more
 * than pieces, because the cutting list, the sew order and the pressing plan
 * are all per-unit.
 *
 * ## The grid DSL
 *
 * A block is an array of rows; each row is whitespace-separated cell tokens.
 * Fabric names are single letters that index into the block's `fabrics` map.
 *
 *   k          a plain patch of fabric k
 *   a/b        half-square triangle, diagonal like "/": a upper-left, b lower-right
 *   a\b        half-square triangle, diagonal like "\": a upper-right, b lower-left
 *   a+b        hourglass (quarter-square): a top and bottom, b left and right
 *   a^b        flying goose pointing up,    2 cells wide - goose a on sky b
 *   avb        flying goose pointing down,  2 cells wide
 *   a>b        flying goose pointing right, 2 cells tall
 *   a<b        flying goose pointing left,  2 cells tall
 *   .          continuation of the multi-cell unit to the left or above
 *
 * A half-square triangle or hourglass can be bigger than one cell: follow it
 * with "." cells to the right and fill the rows below with ".", and it becomes
 * an n by n unit. That is how a bear paw gets its big claws.
 *
 * Adjacent plain patches of the same fabric merge into the largest rectangles
 * they can form, which is what keeps a block in the 12-30 piece range a quilter
 * actually wants, instead of 64 tiny squares.
 *
 * ## Stitch-and-flip corners
 *
 * Every commercial pattern in the pile - a chicken, a maple leaf, a star made
 * of geese - builds its diagonals the same way: lay a small square on the
 * corner of a rectangle, sew across it corner to corner, trim, flip. Nobody
 * cuts a triangle. So when a one-cell half-square triangle sits at the corner
 * of a run of plain cells and its inner triangle is the run's fabric, the
 * merge absorbs it: the rectangle grows over that cell and records a corner.
 * Two corners on one end of a strip make a flying goose; four corners on a
 * square make a square-in-a-square. Pass `corners: 'hst'` to keep every
 * triangle as its own two-piece unit instead - it wastes less fabric.
 *
 * ## Sub-blocks
 *
 * `subgrid: 2` says the block is really four quarter-blocks that are made
 * separately and then joined, and merging never crosses the boundary. That is
 * how rail fence and most big sampler blocks are actually sewn.
 */

import { inches, label } from './units.js';
import { repairForGuillotine } from './partition.js';

export const HST_DIRS = ['/', '\\'];
export const GEESE_DIRS = { '^': 'up', v: 'down', '>': 'right', '<': 'left' };
export const CORNER_METHODS = {
  flip: {
    id: 'flip',
    name: 'Stitch-and-flip',
    blurb: 'Lay a square on the corner, sew the diagonal, trim and flip. Fewest pieces, easiest to sew.',
    recommended: true,
  },
  hst: {
    id: 'hst',
    name: 'Half-square triangles',
    blurb: 'Every diagonal is its own two-at-a-time unit. More seams, less wasted fabric.',
  },
};
export const DEFAULT_CORNERS = 'flip';

/** Finished block sizes a grid can be drawn at without a fractional cell. */
export const SIZE_CHOICES = [6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 24];
export function validSizes(gridSize, choices = SIZE_CHOICES) {
  return choices.filter((s) => inches(s) % gridSize === 0);
}

export class PatternError extends Error {
  constructor(message, where) {
    super(where ? `${message} (${where})` : message);
    this.name = 'PatternError';
    this.where = where;
  }
}

function bbox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Split a cell token into [fabricA, operator, fabricB], or null for a plain
 * patch. Fabric keys are single characters, so a compound cell is exactly 3.
 */
function splitCell(token) {
  if (token.length === 1) return null;
  if (token.length !== 3) {
    throw new PatternError(`cell "${token}" is not a fabric letter or a 3-character unit like "a/b"`);
  }
  return [token[0], token[1], token[2]];
}

/**
 * Which corner of a rectangle of fabric `a` a one-cell HST could clip, and
 * with what fabric. Null if the HST does not have `a` on the inside.
 */
function cornerForm(token, a) {
  const parts = splitCell(token);
  if (!parts) return null;
  const [x, op, y] = parts;
  if (x === y) return null;
  if (op === '/') {
    if (y === a) return { pos: 'tl', fabric: x };
    if (x === a) return { pos: 'br', fabric: y };
  } else if (op === '\\') {
    if (y === a) return { pos: 'tr', fabric: x };
    if (x === a) return { pos: 'bl', fabric: y };
  }
  return null;
}

const P = (x, y) => ({ x, y });

/** A rectangle with some corners clipped off, walked clockwise. */
function clippedRect(x, y, w, h, s, clipped) {
  const pts = [];
  if (clipped.tl) pts.push(P(x + s, y));
  else pts.push(P(x, y));
  if (clipped.tr) pts.push(P(x + w - s, y), P(x + w, y + s));
  else pts.push(P(x + w, y));
  if (clipped.br) pts.push(P(x + w, y + h - s), P(x + w - s, y + h));
  else pts.push(P(x + w, y + h));
  if (clipped.bl) pts.push(P(x + s, y + h), P(x, y + h - s));
  else pts.push(P(x, y + h));
  if (clipped.tl) pts.push(P(x, y + s));
  // A goose made of two corners has a zero-length top edge; drop the repeat.
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y)
    .filter((p, i, arr) => i < arr.length - 1 || p.x !== arr[0].x || p.y !== arr[0].y);
}

function cornerTriangle(pos, x, y, w, h, s) {
  switch (pos) {
    case 'tl': return [P(x, y), P(x + s, y), P(x, y + s)];
    case 'tr': return [P(x + w - s, y), P(x + w, y), P(x + w, y + s)];
    case 'br': return [P(x + w, y + h - s), P(x + w, y + h), P(x + w - s, y + h)];
    default: return [P(x, y + h - s), P(x + s, y + h), P(x, y + h)];
  }
}

/** Geometry for each unit, in sixteenths, relative to the block origin. */
function unitPieces(u) {
  const { kind, dir, a, b, x, y, w, h } = u;
  switch (kind) {
    case 'patch': {
      const corners = u.corners ?? [];
      if (!corners.length) {
        return [{ fabric: a, role: 'patch', polygon: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] }];
      }
      const s = corners[0].size;
      const clipped = Object.fromEntries(corners.map((c) => [c.pos, true]));
      const order = { tl: 0, tr: 1, bl: 2, br: 3 };
      return [
        { fabric: a, role: 'patch', polygon: clippedRect(x, y, w, h, s, clipped) },
        ...[...corners]
          .sort((p, q) => order[p.pos] - order[q.pos])
          .map((c) => ({ fabric: c.fabric, role: 'corner', pos: c.pos, polygon: cornerTriangle(c.pos, x, y, w, h, s) })),
      ];
    }

    case 'hst':
      return dir === '/'
        ? [
            { fabric: a, role: 'triangle', polygon: [P(x, y), P(x + w, y), P(x, y + h)] },
            { fabric: b, role: 'triangle', polygon: [P(x + w, y), P(x + w, y + h), P(x, y + h)] },
          ]
        : [
            { fabric: a, role: 'triangle', polygon: [P(x, y), P(x + w, y), P(x + w, y + h)] },
            { fabric: b, role: 'triangle', polygon: [P(x, y), P(x + w, y + h), P(x, y + h)] },
          ];

    case 'qst': {
      const cx = x + w / 2, cy = y + h / 2;
      return [
        { fabric: a, role: 'triangle', polygon: [P(x, y), P(x + w, y), P(cx, cy)] },
        { fabric: b, role: 'triangle', polygon: [P(x + w, y), P(x + w, y + h), P(cx, cy)] },
        { fabric: a, role: 'triangle', polygon: [P(x + w, y + h), P(x, y + h), P(cx, cy)] },
        { fabric: b, role: 'triangle', polygon: [P(x, y + h), P(x, y), P(cx, cy)] },
      ];
    }

    case 'geese': {
      const mx = x + w / 2, my = y + h / 2;
      if (dir === '^')
        return [
          { fabric: a, role: 'goose', polygon: [P(x, y + h), P(mx, y), P(x + w, y + h)] },
          { fabric: b, role: 'sky', polygon: [P(x, y), P(mx, y), P(x, y + h)] },
          { fabric: b, role: 'sky', polygon: [P(mx, y), P(x + w, y), P(x + w, y + h)] },
        ];
      if (dir === 'v')
        return [
          { fabric: a, role: 'goose', polygon: [P(x, y), P(x + w, y), P(mx, y + h)] },
          { fabric: b, role: 'sky', polygon: [P(x, y), P(mx, y + h), P(x, y + h)] },
          { fabric: b, role: 'sky', polygon: [P(x + w, y), P(x + w, y + h), P(mx, y + h)] },
        ];
      if (dir === '>')
        return [
          { fabric: a, role: 'goose', polygon: [P(x, y), P(x + w, my), P(x, y + h)] },
          { fabric: b, role: 'sky', polygon: [P(x, y), P(x + w, y), P(x + w, my)] },
          { fabric: b, role: 'sky', polygon: [P(x + w, my), P(x + w, y + h), P(x, y + h)] },
        ];
      return [
        { fabric: a, role: 'goose', polygon: [P(x + w, y), P(x + w, y + h), P(x, my)] },
        { fabric: b, role: 'sky', polygon: [P(x, y), P(x + w, y), P(x, my)] },
        { fabric: b, role: 'sky', polygon: [P(x, my), P(x + w, y + h), P(x, y + h)] },
      ];
    }

    default:
      throw new PatternError(`unknown unit kind "${kind}"`);
  }
}

/**
 * Parse a block definition into units and pieces.
 *
 * @param {object} def   `{ id, name, fabrics, rows, subgrid?, ... }`
 * @param {object} opts
 *   blockSize  finished block size in inches (default 12)
 *   repair     split merged patches to avoid partial seams (default true)
 *   corners    'flip' absorbs corner triangles into their patch, 'hst' keeps
 *              every triangle as a half-square-triangle unit
 */
export function buildBlock(def, { blockSize = 12, repair = true, corners = DEFAULT_CORNERS } = {}) {
  if (!def || !Array.isArray(def.rows) || def.rows.length === 0) {
    throw new PatternError('block has no rows', def?.id);
  }
  if (!CORNER_METHODS[corners]) throw new RangeError(`unknown corner method: ${corners}`);

  const grid = def.rows.map((r) => String(r).trim().split(/\s+/));
  const rows = grid.length;
  const cols = grid[0].length;
  for (let r = 0; r < rows; r++) {
    if (grid[r].length !== cols) {
      throw new PatternError(`row ${r + 1} has ${grid[r].length} cells, expected ${cols}`, def.id);
    }
  }
  if (rows !== cols) {
    throw new PatternError(`block grid is ${cols}x${rows}; blocks must be square`, def.id);
  }

  const blockSixteenths = inches(blockSize);
  if (blockSixteenths % cols !== 0) {
    throw new PatternError(
      `a ${blockSize}" block does not divide evenly into ${cols} cells; ` +
        `try a grid of ${[2, 3, 4, 5, 6, 8, 10, 12].filter((n) => blockSixteenths % n === 0).join(', ')}`,
      def.id,
    );
  }
  const cell = blockSixteenths / cols;

  const subgrid = Number(def.subgrid) || 1;
  if (subgrid > 1 && cols % subgrid !== 0) {
    throw new PatternError(`a ${cols}-cell grid does not split into ${subgrid} sub-blocks`, def.id);
  }
  const subOf = (r, c) => `${Math.floor((r * subgrid) / rows)},${Math.floor((c * subgrid) / cols)}`;
  const sameSub = (r0, c0, r1, c1) => subgrid === 1 || subOf(r0, c0) === subOf(r1, c1);

  const taken = grid.map((r) => r.map(() => false));
  const units = [];
  const at = (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols ? grid[r][c] : null);
  const plainAt = (r, c) => {
    const t = at(r, c);
    return t && t.length === 1 && t !== '.' ? t : null;
  };
  /** How many cells across an HST/QST at (r, c) spans, counting "." to its right. */
  const spanOf = (r, c) => {
    let n = 1;
    while (c + n < cols && at(r, c + n) === '.' && !taken[r][c + n] && sameSub(r, c, r, c + n)) n++;
    return n;
  };

  /**
   * Mark a rectangle of cells as consumed. A merged patch covers cells that
   * repeat its own fabric letter; a multi-cell unit covers "." continuations.
   */
  const claim = (r, c, w, h, token, { continuation } = {}) => {
    for (let i = 0; i < h; i++) {
      for (let k = 0; k < w; k++) {
        if (r + i >= rows || c + k >= cols) {
          throw new PatternError(`unit "${token}" at row ${r + 1}, column ${c + 1} runs off the block`, def.id);
        }
        const other = grid[r + i][c + k];
        const isOrigin = i === 0 && k === 0;
        if (!isOrigin && continuation && other !== '.') {
          throw new PatternError(
            `unit "${token}" at row ${r + 1}, column ${c + 1} needs a "." continuation cell, found "${other}"`,
            def.id,
          );
        }
        if (taken[r + i][c + k]) {
          throw new PatternError(`cells overlap at row ${r + i + 1}, column ${c + k + 1}`, def.id);
        }
        if (!isOrigin && continuation && !sameSub(r, c, r + i, c + k)) {
          throw new PatternError(`unit "${token}" at row ${r + 1}, column ${c + 1} crosses a sub-block boundary`, def.id);
        }
        taken[r + i][c + k] = true;
      }
    }
  };

  /**
   * Grow a rectangle of fabric `a` from (r, c). Plain cells of `a` extend it;
   * one-cell HSTs whose inner triangle is `a` can be absorbed as corners when
   * they land in a corner position. Returns null if the origin cannot start
   * a patch of `a` at all.
   */
  const absorbing = corners === 'flip';
  const cornerAt = (r, c, rr, cc, a) => {
    if (!absorbing || taken[rr][cc] || !sameSub(r, c, rr, cc)) return null;
    const t = at(rr, cc);
    if (!t || t.length !== 3 || spanOf(rr, cc) !== 1) return null;
    return cornerForm(t, a);
  };

  const grow = (r, c, a, { rightCorner = true, rowCorners = true } = {}) => {
    const found = [];
    let forceH1 = false;
    let forceW1 = false;

    if (plainAt(r, c) !== a) {
      const f = cornerAt(r, c, r, c, a);
      if (!f || f.pos === 'br') return null;
      if (f.pos === 'bl') forceH1 = true;
      if (f.pos === 'tr') forceW1 = true;
      found.push({ ...f, r, c });
    }

    let w = 1;
    if (!forceW1) {
      while (c + w < cols && !taken[r][c + w] && sameSub(r, c, r, c + w)) {
        if (plainAt(r, c + w) === a) { w++; continue; }
        const f = rightCorner ? cornerAt(r, c, r, c + w, a) : null;
        if (f && (f.pos === 'tr' || f.pos === 'br')) {
          if (f.pos === 'br') forceH1 = true;
          found.push({ ...f, r, c: c + w });
          w++;
        }
        break;
      }
    }

    let h = 1;
    if (!forceH1) {
      grow: while (r + h < rows) {
        const lastRow = [];
        for (let k = 0; k < w; k++) {
          const rr = r + h, cc = c + k;
          if (taken[rr][cc] || !sameSub(r, c, rr, cc)) break grow;
          if (plainAt(rr, cc) === a) continue;
          const f = rowCorners ? cornerAt(r, c, rr, cc, a) : null;
          if (f && k === 0 && f.pos === 'bl') { lastRow.push({ ...f, r: rr, c: cc }); continue; }
          if (f && k === w - 1 && f.pos === 'br') { lastRow.push({ ...f, r: rr, c: cc }); continue; }
          break grow;
        }
        h++;
        if (lastRow.length) { found.push(...lastRow); break; }
      }
    }
    return { w, h, corners: found, area: w * h };
  };

  /**
   * Grow, but give a corner cell to whichever side makes the bigger patch. A
   * sky strip should not steal the corner that would have made the roof one
   * rectangle instead of three.
   */
  const bestGrow = (r, c, a) => {
    let g = grow(r, c, a);
    if (!g) return null;
    const contested = (k) => {
      if (k.r === r && k.c === c) return false; // the origin is ours by definition
      const other = grow(k.r, k.c, k.fabric, { rightCorner: false, rowCorners: false });
      return other && other.area > g.area;
    };
    const right = g.corners.find((k) => k.r === r && k.c !== c);
    if (right && contested(right)) g = grow(r, c, a, { rightCorner: false });
    const below = g.corners.filter((k) => k.r !== r);
    if (below.some(contested)) g = grow(r, c, a, { rightCorner: !(right && contested(right)), rowCorners: false });
    return g;
  };

  const addPatch = (r, c, a, g) => {
    // claim() marks every cell in the rectangle, corner cells included.
    claim(r, c, g.w, g.h, a);
    units.push({
      kind: 'patch', dir: null, a, b: null,
      cells: { r, c, w: g.w, h: g.h },
      x: c * cell, y: r * cell, w: g.w * cell, h: g.h * cell,
      corners: g.corners.map((k) => ({ pos: k.pos, fabric: k.fabric, size: cell })),
    });
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r][c]) continue;
      const token = grid[r][c];
      if (token === '.') {
        throw new PatternError(`stray "." continuation at row ${r + 1}, column ${c + 1}`, def.id);
      }

      const parts = splitCell(token);

      if (!parts) {
        // Plain patch: grow right as far as possible, then down, greedily.
        const g = bestGrow(r, c, token);
        // claim() checks overlaps; corners are marked taken separately because
        // their cell holds a triangle token, not the patch's own letter.
        const cornerCells = new Set(g.corners.map((k) => `${k.r},${k.c}`));
        for (let i = 0; i < g.h; i++) {
          for (let k = 0; k < g.w; k++) {
            if (!cornerCells.has(`${r + i},${c + k}`) && plainAt(r + i, c + k) !== token) {
              throw new PatternError(`merge produced an inconsistent patch at row ${r + 1}, column ${c + 1}`, def.id);
            }
          }
        }
        addPatch(r, c, token, g);
        continue;
      }

      const [a, op, b] = parts;
      if (HST_DIRS.includes(op)) {
        const n = spanOf(r, c);
        if (n === 1 && corners === 'flip') {
          // Could this triangle be the corner of a rectangle instead? Try both
          // of its fabrics and keep whichever makes the bigger patch.
          let best = null;
          for (const fab of [a, b]) {
            const g = bestGrow(r, c, fab);
            if (g && g.area >= 2 && (!best || g.area > best.g.area)) best = { fab, g };
          }
          if (best) {
            addPatch(r, c, best.fab, best.g);
            continue;
          }
        }
        claim(r, c, n, n, token, { continuation: true });
        units.push({
          kind: 'hst', dir: op, a, b,
          cells: { r, c, w: n, h: n },
          x: c * cell, y: r * cell, w: n * cell, h: n * cell,
        });
      } else if (op === '+') {
        const n = spanOf(r, c);
        claim(r, c, n, n, token, { continuation: true });
        units.push({
          kind: 'qst', dir: '+', a, b,
          cells: { r, c, w: n, h: n },
          x: c * cell, y: r * cell, w: n * cell, h: n * cell,
        });
      } else if (op in GEESE_DIRS) {
        const wide = op === '^' || op === 'v';
        const w = wide ? 2 : 1;
        const h = wide ? 1 : 2;
        claim(r, c, w, h, token, { continuation: true });
        units.push({
          kind: 'geese', dir: op, a, b,
          cells: { r, c, w, h },
          x: c * cell, y: r * cell, w: w * cell, h: h * cell,
        });
      } else {
        throw new PatternError(`unknown unit operator "${op}" in cell "${token}"`, def.id);
      }
    }
  }

  // Greedy merging can hook two patches around each other in a way that leaves
  // no straight seam. One extra seam is always the better trade.
  const region = { x0: 0, y0: 0, x1: blockSixteenths, y1: blockSixteenths };
  const repaired = repair ? repairForGuillotine(units, region) : { units, splits: 0 };
  const finalUnits = repaired.units;

  // Units and pieces are numbered in reading order, so a quilter working down
  // the cutting list moves left-to-right, top-to-bottom across the diagram.
  finalUnits.sort((p, q) => p.y - q.y || p.x - q.x);
  finalUnits.forEach((u, i) => {
    u.index = i;
    u.pieces = unitPieces(u);
    u.pieces.forEach((p) => {
      p.bbox = bbox(p.polygon);
      p.unit = i;
    });
  });

  const pieces = finalUnits.flatMap((u) => u.pieces);
  pieces.sort((p, q) => p.bbox.minY - q.bbox.minY || p.bbox.minX - q.bbox.minX);
  pieces.forEach((p, i) => (p.label = label(i)));

  const used = new Set(pieces.map((p) => p.fabric));
  for (const key of used) {
    if (!def.fabrics?.[key]) {
      throw new PatternError(`cell uses fabric "${key}" but the block defines no such fabric`, def.id);
    }
  }

  return {
    ...def,
    grid,
    gridSize: cols,
    subgrid,
    blockSize,
    cell,
    size: blockSixteenths,
    corners,
    units: finalUnits,
    merges: repaired.splits,
    pieces,
    fabricsUsed: [...used],
  };
}

/** Pretty count of how many of each unit type a block uses. */
export function unitCounts(block) {
  const counts = { patch: 0, hst: 0, qst: 0, geese: 0, flip: 0, corners: 0 };
  for (const u of block.units) {
    counts[u.kind]++;
    if (u.corners?.length) {
      counts.flip++;
      counts.corners += u.corners.length;
    }
  }
  return counts;
}

/**
 * The same block flipped left to right. A chicken facing the other way, so a
 * row of them can face each other. Tokens are reversed and the diagonals and
 * geese swap direction; continuation cells are moved back behind their unit.
 */
export function mirrorDef(def) {
  const swap = { '/': '\\', '\\': '/', '<': '>', '>': '<' };
  // Parse first, so every "." is known to belong to a particular unit, then
  // re-emit the grid with each unit's origin moved to its mirrored column.
  const built = buildBlock(def, { blockSize: def.rows.length, repair: false, corners: 'hst' });
  const n = built.gridSize;
  const grid = Array.from({ length: n }, () => Array(n).fill('.'));
  for (const u of built.units) {
    const { r, c, w, h } = u.cells;
    const mc = n - c - w;
    if (u.kind === 'patch') {
      for (let i = 0; i < h; i++) for (let k = 0; k < w; k++) grid[r + i][mc + k] = u.a;
    } else {
      grid[r][mc] = `${u.a}${swap[u.dir] ?? u.dir}${u.b}`;
    }
  }
  return {
    ...def,
    id: `${def.id}-mirror`,
    name: `${def.name} (mirrored)`,
    rows: grid.map((row) => row.join(' ')),
    mirrored: true,
  };
}

export { bbox };
