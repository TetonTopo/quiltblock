/**
 * Hexagons - English paper piecing.
 *
 * A hexagon quilt breaks the house rules on purpose: its edges meet at 120
 * degrees, nothing is rotary-cut against a ruler, and it is sewn by hand over
 * paper templates. So it does not go through the block engine at all. It is
 * its own small pattern type: a layout of hexies, a count per fabric, a
 * template to print, and the yardage for the squares you cut them from.
 *
 * The one thing it shares with the rest of the engine is honesty about size:
 * a "1 inch hexagon" means a one-inch SIDE, which is what every paper-piece
 * supplier means, and everything is derived from that.
 */

import { fmt, inches, toInches, luminance } from './units.js';
import { yardsFor, USABLE_WOF } from './cutting.js';

const SQRT3 = Math.sqrt(3);

export const HEX_SIZES = [
  { id: 'half', side: 0.5, name: '½" hexagon', blurb: 'Tiny. A whole evening for a rosette.' },
  { id: 'three-quarter', side: 0.75, name: '¾" hexagon' },
  { id: 'one', side: 1, name: '1" hexagon', blurb: 'The classic Grandmother’s Flower Garden size.', recommended: true },
  { id: 'one-half', side: 1.5, name: '1½" hexagon' },
  { id: 'two', side: 2, name: '2" hexagon', blurb: 'Quick, and shows off a print.' },
];

export const HEX_LAYOUTS = {
  garden: {
    id: 'garden',
    name: 'Flower garden',
    blurb: 'Rosettes of six petals around a centre, set in a path of one fabric. The one everyone’s grandmother made.',
  },
  'double-garden': {
    id: 'double-garden',
    name: 'Double rosettes',
    blurb: 'A second ring of twelve around each flower. Bigger blooms, fewer of them.',
  },
  scrappy: {
    id: 'scrappy',
    name: 'Scrappy field',
    blurb: 'Every hexie a different print, no two alike touching. What the runner in the photo does.',
  },
  diamonds: {
    id: 'diamonds',
    name: 'Diamonds',
    blurb: 'Hexies in diagonal bands of colour. Reads as a big argyle.',
  },
};

/** Sides in inches -> geometry in inches. Pointy-top hexagons. */
export function hexGeometry(side) {
  return {
    side,
    acrossFlats: side * SQRT3, // width, point-up
    acrossCorners: 2 * side, // height, point-up
    rowPitch: 1.5 * side, // vertical distance between row centres
    area: (3 * SQRT3 / 2) * side * side,
    /** The square you cut a hexie from, with ⅜" to fold over the paper. */
    cutSquare: Math.ceil((2 * side + 0.75) * 8) / 8,
  };
}

/**
 * Lay out a field of hexagons in offset rows.
 *
 * @param opts
 *   side        hexagon side in inches
 *   width,height  target finished size in inches (the field is trimmed to it)
 *   layout      one of HEX_LAYOUTS
 *   fabrics     [{ name, hex }] - petals / scraps; the first is the path in
 *               garden layouts unless `path` is given
 *   path        { name, hex } for the path between rosettes
 *   centre      { name, hex } for rosette centres
 */
export function planHexagons(opts = {}) {
  const {
    side = 1,
    width = 18,
    height = 42,
    layout = 'garden',
    fabrics = [],
    path = null,
    centre = null,
    seed = 7,
  } = opts;
  if (!HEX_LAYOUTS[layout]) throw new RangeError(`unknown hexagon layout: ${layout}`);
  const g = hexGeometry(side);

  const cols = Math.max(1, Math.floor(width / g.acrossFlats));
  const rows = Math.max(1, Math.floor((height - 0.5 * side) / g.rowPitch));

  const palette = fabrics.length ? fabrics : [{ name: 'Print 1', hex: '#F7B8C4' }, { name: 'Print 2', hex: '#7FA9D1' }];
  const pathFabric = path ?? { name: 'Path - aqua', hex: '#BFE3E0' };
  const centreFabric = centre ?? { name: 'Centres - butter', hex: '#F2D24B' };

  // Rosette centres sit on a scaled copy of the hex lattice. A flower of one
  // ring (7 hexies) plus a single path between flowers needs centres 3 apart;
  // a two-ring flower (19) plus a path needs them 5 apart. Every hex then
  // reads its role from its distance to the nearest centre.
  let random = seed;
  const rnd = () => (random = (random * 1103515245 + 12345) % 2147483648) / 2147483648;

  const hexes = [];
  const ringOf = (q, r, spacing) => {
    let best = null;
    const bq = Math.floor(q / spacing) * spacing;
    const br = Math.floor(r / spacing) * spacing;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cq = bq + i * spacing, cr = br + j * spacing;
        const dq = q - cq, dr = r - cr;
        const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
        if (!best || dist < best.dist) best = { dist, cq, cr };
      }
    }
    return best;
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // offset rows: odd rows shift half a hex right
      const x = col * g.acrossFlats + (row % 2 ? g.acrossFlats / 2 : 0) + g.acrossFlats / 2;
      const y = row * g.rowPitch + side;
      // axial coordinates for the lattice maths
      const r = row;
      const q = col - Math.floor(row / 2);
      let fabric;
      let role = 'field';
      if (layout === 'garden' || layout === 'double-garden') {
        const double = layout === 'double-garden';
        const ring = ringOf(q, r, double ? 5 : 3);
        const key = `${ring.cq},${ring.cr}`;
        if (ring.dist === 0) { fabric = centreFabric; role = 'centre'; }
        else if (ring.dist === 1) { fabric = palette[hashKey(key) % palette.length]; role = 'petal'; }
        else if (ring.dist === 2 && double) { fabric = palette[(hashKey(key) + 1) % palette.length]; role = 'outer'; }
        else { fabric = pathFabric; role = 'path'; }
      } else if (layout === 'diamonds') {
        fabric = palette[((((q + 2 * r) % palette.length) + palette.length) % palette.length)];
      } else {
        // scrappy: pick a fabric different from the left and upper-left neighbours
        const left = hexes[hexes.length - 1]?.fabric;
        const up = row > 0 ? hexes[(row - 1) * cols + col]?.fabric : null;
        let pick = palette[Math.floor(rnd() * palette.length)];
        let guard = 0;
        while ((pick === left || pick === up) && palette.length > 2 && guard++ < 8) pick = palette[Math.floor(rnd() * palette.length)];
        fabric = pick;
      }
      hexes.push({ col, row, q, r, x, y, fabric, role });
    }
  }

  // Counts per fabric, and the squares to cut them from.
  const counts = new Map();
  for (const h of hexes) {
    const k = h.fabric.name;
    if (!counts.has(k)) counts.set(k, { ...h.fabric, count: 0 });
    counts.get(k).count++;
  }
  const cutSq = inches(g.cutSquare);
  const perStrip = Math.floor(USABLE_WOF / cutSq);
  const cutting = [...counts.values()].map((f) => {
    const strips = Math.ceil(f.count / perStrip);
    return {
      ...f,
      cut: `${fmt(cutSq)} square`,
      strips,
      stripWidth: cutSq,
      perStrip,
      yardage: strips * cutSq <= inches(18) && f.count <= Math.floor(inches(21) / cutSq) * Math.floor(inches(18) / cutSq)
        ? { label: 'fat quarter', yards: 0.25 }
        : yardsFor(strips * cutSq),
    };
  }).sort((p, q) => q.count - p.count);

  const finishedW = cols * g.acrossFlats + g.acrossFlats / 2;
  const finishedH = (rows - 1) * g.rowPitch + 2 * side;

  return {
    kind: 'hexagon',
    side,
    geometry: g,
    layout: HEX_LAYOUTS[layout],
    cols,
    rows,
    hexes,
    count: hexes.length,
    cutting,
    papers: hexes.length,
    finished: { w: finishedW, h: finishedH, label: `${fmt(inches(round8(finishedW)))} × ${fmt(inches(round8(finishedH)))}` },
    hours: Math.round((hexes.length * 4) / 60), // ~4 minutes a hexie, basted and sewn
    steps: hexSteps(side, hexes.length, g),
  };
}

const round8 = (n) => Math.round(n * 8) / 8;

function hashKey(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function hexSteps(side, n, g) {
  return [
    `Print ${n} paper templates at 100% and cut them out on the line, or buy ${n} pre-cut ${fmt(inches(side))} paper hexagons - the size is the side, not the width.`,
    `Cut a ${fmt(inches(g.cutSquare))} square of fabric for every hexie (the cutting list says how many of each). You do not need to cut the fabric to a hexagon; the square folds over the paper.`,
    'Pin or glue-baste a paper to the wrong side of a square, fold each edge over the paper in turn and tack it down with a running stitch through the fabric only, or a dab of glue stick. Six folds, one hexie.',
    'Lay the hexies out in the diagram’s order. Rosettes go together petal by petal around the centre; then rosettes join to their paths.',
    'Hold two hexies right sides together and whipstitch the shared edge with small stitches that catch only a thread or two of each fold, not the paper. Pop the papers out once a hexie has neighbours on every side.',
    'Press from the back once the top is done. Appliqué the finished field onto a border fabric, or trim the ragged edge straight and bind it as it is.',
  ];
}

/** The field of hexagons as an SVG, one polygon each. */
export function hexagonsSvg(plan, { scale = 12, labels = false } = {}) {
  const g = plan.geometry;
  const W = (plan.cols + 0.5) * g.acrossFlats * scale;
  const H = ((plan.rows - 1) * g.rowPitch + 2 * plan.side) * scale;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${plan.layout.name} of ${plan.count} hexagons">`];
  for (const h of plan.hexes) {
    out.push(`<polygon points="${hexPoints(h.x * scale, h.y * scale, plan.side * scale)}" fill="${h.fabric.hex}" stroke="#2B2622" stroke-opacity="0.45" stroke-width="0.8"/>`);
    if (labels) {
      out.push(`<text x="${h.x * scale}" y="${h.y * scale}" font-family="Karla, Arial, sans-serif" font-size="${scale * 0.5}" text-anchor="middle" dominant-baseline="central" fill="${luminance(h.fabric.hex) < 140 ? '#F6F1E8' : '#2B2622'}">${h.role[0].toUpperCase()}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}

/** Point-up hexagon corner list. */
function hexPoints(cx, cy, s) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + s * Math.cos(ang)).toFixed(2)},${(cy + s * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * A printable sheet of paper templates at 100%: the finished hexagon (the
 * paper) inside the cutting square, with a one-inch check square. 96 px per
 * inch, which is what browsers print at.
 */
export function hexTemplateSvg(side, { perRow = 4, count = 12 } = {}) {
  const ppi = 96;
  const g = hexGeometry(side);
  const cell = g.cutSquare * ppi + 8;
  const rowsN = Math.ceil(count / perRow);
  const W = perRow * cell + 16;
  const H = rowsN * cell + 16 + ppi + 24;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}px" height="${H}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="hexagon paper templates, ${side} inch side">`];
  out.push(`<rect x="8" y="8" width="${ppi}" height="${ppi}" fill="none" stroke="#2B2622" stroke-width="1.5"/>`);
  out.push(`<text x="${8 + ppi / 2}" y="${8 + ppi / 2}" font-family="Karla, Arial, sans-serif" font-size="10" text-anchor="middle" dominant-baseline="central" fill="#2B2622">1 inch</text>`);
  out.push(`<text x="${ppi + 24}" y="${8 + ppi / 2}" font-family="Karla, Arial, sans-serif" font-size="12" dominant-baseline="central" fill="#2B2622">${fmt(inches(side))} side hexagon · ${fmt(inches(g.cutSquare))} cutting square · print at 100%</text>`);
  for (let i = 0; i < count; i++) {
    const cx = 8 + (i % perRow) * cell + cell / 2;
    const cy = 8 + ppi + 24 + Math.floor(i / perRow) * cell + cell / 2;
    const half = (g.cutSquare * ppi) / 2;
    out.push(`<rect x="${cx - half}" y="${cy - half}" width="${2 * half}" height="${2 * half}" fill="none" stroke="#B8453A" stroke-width="0.8" stroke-dasharray="4 3"/>`);
    out.push(`<polygon points="${hexPoints(cx, cy, side * ppi)}" fill="none" stroke="#2B2622" stroke-width="1.2"/>`);
  }
  out.push('</svg>');
  return out.join('');
}
