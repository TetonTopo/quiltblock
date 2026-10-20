/**
 * Full-size printing: cut a drawing that is bigger than a sheet of paper into
 * pages that tape back together.
 *
 * A pattern that will be traced, pinned or sewn onto has to print at 100%, and
 * a 16" block does not fit on letter paper. So the drawing is laid over a grid
 * of pages with a strip of overlap between neighbours. Every page draws the
 * same registration marks in the same place in the drawing, so where two pages
 * overlap their marks sit on top of each other: trim one page along its dashed
 * edge, lay it over its neighbour, line up the marks, tape.
 *
 * Pages are named like a map - rows are letters, columns are numbers - so
 * "B2" is second row, second column, and every page says who its neighbours
 * are. Each page carries a one-inch ruler so a home printer that quietly
 * scaled to fit gets caught before anything is cut.
 *
 * Everything is in sixteenths of an inch, the same as the rest of the engine,
 * and the drawing must be an SVG whose viewBox is in sixteenths too (render
 * any of the block or template SVGs with `scale: 1`).
 */

import { inches, fmt } from './units.js';
import { esc } from './render.js';

export const PAPERS = {
  letter: { id: 'letter', name: 'US Letter', w: inches(8.5), h: inches(11) },
  legal: { id: 'legal', name: 'US Legal', w: inches(8.5), h: inches(14) },
  tabloid: { id: 'tabloid', name: 'Tabloid (11 × 17)', w: inches(11), h: inches(17) },
  a4: { id: 'a4', name: 'A4', w: 132, h: 187 }, // 210 × 297 mm, to the nearest sixteenth
};

export const TILE_DEFAULTS = {
  paper: 'letter',
  /** What a home printer cannot reach. The page itself is drawn inside this. */
  margin: inches(0.5),
  /** The strip two neighbouring pages share. */
  overlap: inches(0.5),
  /** Room at the foot of each page for its name, its neighbours and the ruler. */
  footer: inches(0.75),
  /** 'portrait', 'landscape', or 'auto' for whichever needs fewer sheets. */
  orientation: 'auto',
};

const ROWS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function along(total, area, overlap) {
  if (total <= area) return 1;
  return Math.ceil((total - overlap) / (area - overlap));
}

function layoutFor(width, height, paper, o, orientation) {
  const [pw, ph] = orientation === 'landscape' ? [paper.h, paper.w] : [paper.w, paper.h];
  const printW = pw - 2 * o.margin;
  const printH = ph - 2 * o.margin;
  const areaW = printW;
  const areaH = printH - o.footer;
  if (areaW <= o.overlap || areaH <= o.overlap) {
    throw new RangeError('the margins and overlap leave no room on the page');
  }
  const cols = along(width, areaW, o.overlap);
  const rows = along(height, areaH, o.overlap);
  return { orientation, printW, printH, areaW, areaH, cols, rows, count: cols * rows };
}

/**
 * Plan the pages for a drawing of `width` × `height` sixteenths.
 * Returns the grid, the sheet geometry, and one entry per page giving the
 * window of the drawing it shows and its neighbours.
 */
export function tilePlan(width, height, opts = {}) {
  const o = { ...TILE_DEFAULTS, ...opts };
  const paper = typeof o.paper === 'object' ? o.paper : PAPERS[o.paper];
  if (!paper) throw new RangeError(`unknown paper size: ${o.paper}`);
  if (!(width > 0 && height > 0)) throw new RangeError('the drawing has no size');

  let L;
  if (o.orientation === 'auto') {
    const portrait = layoutFor(width, height, paper, o, 'portrait');
    const landscape = layoutFor(width, height, paper, o, 'landscape');
    L = landscape.count < portrait.count ? landscape : portrait;
  } else {
    L = layoutFor(width, height, paper, o, o.orientation);
  }
  if (L.rows > ROWS.length) throw new RangeError('that drawing needs more than 26 rows of pages');

  const stepX = L.areaW - o.overlap;
  const stepY = L.areaH - o.overlap;
  const name = (r, c) => `${ROWS[r]}${c + 1}`;

  const pages = [];
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      const x = L.cols === 1 ? 0 : c * stepX;
      const y = L.rows === 1 ? 0 : r * stepY;
      pages.push({
        id: name(r, c),
        row: r,
        col: c,
        index: pages.length,
        x,
        y,
        w: Math.min(L.areaW, width - x),
        h: Math.min(L.areaH, height - y),
        left: c > 0 ? name(r, c - 1) : null,
        right: c < L.cols - 1 ? name(r, c + 1) : null,
        above: r > 0 ? name(r - 1, c) : null,
        below: r < L.rows - 1 ? name(r + 1, c) : null,
      });
    }
  }

  return {
    paper,
    orientation: L.orientation,
    width,
    height,
    cols: L.cols,
    rows: L.rows,
    count: pages.length,
    margin: o.margin,
    overlap: o.overlap,
    footer: o.footer,
    printW: L.printW,
    printH: L.printH,
    areaW: L.areaW,
    areaH: L.areaH,
    stepX,
    stepY,
    pages,
  };
}

/**
 * Where the registration marks go, in drawing coordinates. Two marks on every
 * shared edge, in the middle of the overlap strip, a quarter and three
 * quarters of the way along - so both pages that share the edge draw them.
 */
export function registrationMarks(plan) {
  const marks = [];
  const { overlap, stepX, stepY, cols, rows, width, height } = plan;
  for (let c = 1; c < cols; c++) {
    const x = c * stepX + overlap / 2;
    for (let r = 0; r < rows; r++) {
      const y0 = r * stepY;
      const y1 = Math.min(height, y0 + plan.areaH);
      for (const t of [0.25, 0.75]) marks.push({ x, y: y0 + (y1 - y0) * t });
    }
  }
  for (let r = 1; r < rows; r++) {
    const y = r * stepY + overlap / 2;
    for (let c = 0; c < cols; c++) {
      const x0 = c * stepX;
      const x1 = Math.min(width, x0 + plan.areaW);
      for (const t of [0.25, 0.75]) marks.push({ x: x0 + (x1 - x0) * t, y });
    }
  }
  return marks;
}

function parseSvg(svg) {
  const m = /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/.exec(svg);
  if (!m) throw new Error('the drawing has no viewBox');
  const open = svg.indexOf('>', svg.indexOf('<svg'));
  const close = svg.lastIndexOf('</svg>');
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4], inner: svg.slice(open + 1, close) };
}

const mark = ({ x, y }, r = 5) =>
  `<g stroke="#2B2622" stroke-width="0.5" fill="none">` +
  `<circle cx="${x}" cy="${y}" r="${r}"/>` +
  `<line x1="${x - r * 1.6}" y1="${y}" x2="${x + r * 1.6}" y2="${y}"/>` +
  `<line x1="${x}" y1="${y - r * 1.6}" x2="${x}" y2="${y + r * 1.6}"/></g>`;

function miniMap(plan, page, x, y, cell = 5) {
  const out = [];
  for (const p of plan.pages) {
    out.push(
      `<rect x="${x + p.col * cell}" y="${y + p.row * cell}" width="${cell - 0.8}" height="${cell - 0.8}" ` +
        `fill="${p.id === page.id ? '#2B2622' : '#ffffff'}" stroke="#2B2622" stroke-width="0.4"/>`,
    );
  }
  return out.join('');
}

function neighbourText(page) {
  const joins = [];
  if (page.left) joins.push(`${page.left} on the left`);
  if (page.above) joins.push(`${page.above} above`);
  if (!joins.length) return 'Start here. Lay the other pages over this one.';
  return `Trim the dashed edge${joins.length > 1 ? 's' : ''}, lay over ${joins.join(' and ')}, match the ⊕ marks.`;
}

/**
 * Cut `svg` into pages. Returns `{ plan, pages: [{ id, svg }] }`, each page an
 * SVG sized in real inches to the printable area of the sheet. Print them
 * with the page margin set to `plan.margin` and scaling at 100%.
 *
 * opts: everything `tilePlan` takes, plus `title` for the page footers.
 */
export function tileSvg(svg, opts = {}) {
  const src = parseSvg(svg);
  const plan = tilePlan(src.w, src.h, opts);
  const marks = registrationMarks(plan);
  const title = opts.title ? `${esc(opts.title)} · ` : '';
  // The footer shares its first line with the ruler, so a long name is cut short there.
  const short = (opts.title ?? '').length > 34 ? `${opts.title.slice(0, 33)}…` : opts.title;
  const footTitle = short ? `${esc(short)} · ` : '';
  const font = 'font-family="Karla, Arial, sans-serif" fill="#2B2622"';

  const pages = plan.pages.map((page) => {
    const W = plan.printW;
    const H = plan.printH;
    const fy = plan.areaH; // top of the footer band
    const out = [
      `<svg xmlns="http://www.w3.org/2000/svg" class="tile-page" width="${W / 16}in" height="${H / 16}in" ` +
        `viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}page ${page.id} of ${plan.count}">`,
      `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
      // The window onto the drawing, in the drawing's own coordinates.
      `<svg x="0" y="0" width="${page.w}" height="${page.h}" ` +
        `viewBox="${src.x + page.x} ${src.y + page.y} ${page.w} ${page.h}" overflow="hidden">`,
      src.inner,
      marks.map((m) => mark({ x: src.x + m.x, y: src.y + m.y })).join(''),
      `</svg>`,
    ];

    // Edges that get trimmed are dashed; the rest are the drawing's own edge.
    const edge = (x1, y1, x2, y2, dashed) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#B8453A" stroke-width="${dashed ? 0.8 : 0.3}"` +
      `${dashed ? ' stroke-dasharray="4 3"' : ''}/>`;
    out.push(
      edge(0, 0, page.w, 0, Boolean(page.above)),
      edge(0, 0, 0, page.h, Boolean(page.left)),
      edge(page.w, 0, page.w, page.h, false),
      edge(0, page.h, page.w, page.h, false),
    );

    // Footer: name, neighbours, a one-inch ruler, and where this page sits.
    // The map gets the footer's height whatever the grid; the ruler sits on the
    // title line so the instructions underneath have the full width.
    const cell = Math.min(5, (plan.footer - 2) / plan.rows);
    const mapW = plan.cols * cell;
    const rx = W - mapW - 22; // left end of the ruler
    out.push(
      `<text x="0" y="${fy + 4.5}" ${font} font-size="4" font-weight="700">${footTitle}${page.id}</text>`,
      `<text x="0" y="${fy + 9.5}" ${font} font-size="3.4">${neighbourText(page)}</text>`,
      `<g stroke="#2B2622" stroke-width="0.5">` +
        `<line x1="${rx}" y1="${fy + 3}" x2="${rx + 16}" y2="${fy + 3}"/>` +
        `<line x1="${rx}" y1="${fy + 1}" x2="${rx}" y2="${fy + 5}"/>` +
        `<line x1="${rx + 16}" y1="${fy + 1}" x2="${rx + 16}" y2="${fy + 5}"/></g>`,
      `<text x="${rx - 1.5}" y="${fy + 4}" ${font} font-size="2.8" text-anchor="end">1 inch</text>`,
      miniMap(plan, page, W - mapW, fy + 1, cell),
      '</svg>',
    );
    return { id: page.id, svg: out.join('') };
  });

  return { plan, pages };
}

/** One line for the print view: "6 pages (3 × 2), US Letter landscape". */
export function describeTiles(plan) {
  const grid = plan.count === 1 ? '' : ` (${plan.cols} across × ${plan.rows} down)`;
  return `${plan.count} page${plan.count === 1 ? '' : 's'}${grid}, ${plan.paper.name} ${plan.orientation}, ` +
    `${fmt(plan.overlap)} overlap, ${fmt(plan.width)} × ${fmt(plan.height)} at 100%`;
}
