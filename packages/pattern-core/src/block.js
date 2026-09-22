/**
 * The block model: a grid of cells parsed into pieced UNITS.
 *
 * A unit is a thing you sew at the machine as one sub-assembly before it joins
 * the rest of the block - a plain patch, a half-square triangle, an hourglass,
 * a flying goose. Units matter more than pieces, because the cutting list, the
 * sew order and the pressing plan are all per-unit.
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
 * Adjacent plain patches of the same fabric merge into the largest rectangles
 * they can form, which is what keeps a block in the 12-30 piece range a quilter
 * actually wants, instead of 64 tiny squares.
 */

import { inches, label } from './units.js';
import { repairForGuillotine } from './partition.js';

export const HST_DIRS = ['/', '\\'];
export const GEESE_DIRS = { '^': 'up', v: 'down', '>': 'right', '<': 'left' };

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

/** Geometry for each unit type, in sixteenths, relative to the block origin. */
function unitPieces(kind, dir, a, b, x, y, w, h) {
  const P = (px, py) => ({ x: px, y: py });
  switch (kind) {
    case 'patch':
      return [{ fabric: a, role: 'patch', polygon: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] }];

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
 * @param {object} def   `{ id, name, fabrics, rows, ... }`
 * @param {object} opts  `{ blockSize }` finished block size in inches (default 12)
 */
export function buildBlock(def, { blockSize = 12, repair = true } = {}) {
  if (!def || !Array.isArray(def.rows) || def.rows.length === 0) {
    throw new PatternError('block has no rows', def?.id);
  }
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

  const taken = grid.map((r) => r.map(() => false));
  const units = [];
  const at = (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols ? grid[r][c] : null);
  const plainAt = (r, c) => {
    const t = at(r, c);
    return t && t.length === 1 && t !== '.' ? t : null;
  };

  // Pieces are generated after the repair pass below, because repairing can
  // split a merged patch into two and the geometry has to follow.
  const addUnit = (u) => units.push(u);

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
        taken[r + i][c + k] = true;
      }
    }
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
        let w = 1;
        while (c + w < cols && !taken[r][c + w] && plainAt(r, c + w) === token) w++;
        let h = 1;
        grow: while (r + h < rows) {
          for (let k = 0; k < w; k++) {
            if (taken[r + h][c + k] || plainAt(r + h, c + k) !== token) break grow;
          }
          h++;
        }
        claim(r, c, w, h, token);
        addUnit({
          kind: 'patch', dir: null, a: token, b: null,
          cells: { r, c, w, h },
          x: c * cell, y: r * cell, w: w * cell, h: h * cell,
        });
        continue;
      }

      const [a, op, b] = parts;
      if (HST_DIRS.includes(op)) {
        claim(r, c, 1, 1, token, { continuation: true });
        addUnit({
          kind: 'hst', dir: op, a, b,
          cells: { r, c, w: 1, h: 1 },
          x: c * cell, y: r * cell, w: cell, h: cell,
        });
      } else if (op === '+') {
        claim(r, c, 1, 1, token, { continuation: true });
        addUnit({
          kind: 'qst', dir: '+', a, b,
          cells: { r, c, w: 1, h: 1 },
          x: c * cell, y: r * cell, w: cell, h: cell,
        });
      } else if (op in GEESE_DIRS) {
        const wide = op === '^' || op === 'v';
        const w = wide ? 2 : 1;
        const h = wide ? 1 : 2;
        claim(r, c, w, h, token, { continuation: true });
        addUnit({
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
    u.pieces = unitPieces(u.kind, u.dir, u.a, u.b, u.x, u.y, u.w, u.h);
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
    blockSize,
    cell,
    size: blockSixteenths,
    units: finalUnits,
    merges: repaired.splits,
    pieces,
    fabricsUsed: [...used],
  };
}

/** Pretty count of how many of each unit type a block uses. */
export function unitCounts(block) {
  const counts = { patch: 0, hst: 0, qst: 0, geese: 0 };
  for (const u of block.units) counts[u.kind]++;
  return counts;
}

export { bbox };
