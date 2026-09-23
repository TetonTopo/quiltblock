/**
 * QuiltBlock Studio - the storefront.
 *
 * Every diagram, cut size, sew step, pressing arrow and yard of fabric on this
 * page is produced by `packages/pattern-core` at render time. Change the seam
 * allowance in the workbench and the whole pattern is rebuilt, because that is
 * the only honest way to sell a pattern with options on it.
 */

import {
  makePattern,
  LIBRARY,
  HEXAGON_LIBRARY,
  SUBJECTS,
  PRICING,
  SEAM_PROFILES,
  TRIM_STYLES,
  CORNER_METHODS,
  COLORWAYS,
  TIERS,
  TIER_ORDER,
  DEFAULT_TIER,
  QUILT_SIZES,
  SETTINGS,
  layoutFor,
  planHexagons,
  hexagonsSvg,
  hexTemplateSvg,
  HEX_SIZES,
  HEX_LAYOUTS,
  fmt,
  inches,
  unitCounts,
  stripSvg,
} from '../../packages/pattern-core/src/index.js';

import {
  generate,
  generatorStatus,
  GenerateError,
  checkout,
  findPrinters,
  FULFILMENT,
  DEMO_CARDS,
} from './api.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n) => `$${n.toFixed(2)}`;
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ------------------------------------------------------------------ state */

const REMEMBERED = ['seam', 'trim', 'blockSize', 'method', 'corners', 'colorway'];

const state = {
  seam: 'scant-quarter',
  trim: 'classic',
  blockSize: 12,
  corners: 'flip',
  colorway: 'original',
  method: 'patchwork',
  view: 'home',
  blockId: 'teapot',
  preview: 'block',
  generated: null,
  cart: null,
  fulfilment: 'download',
  card: DEMO_CARDS[0].id,
  /** Quilt planner settings, per block id. */
  quilt: {},
  /** Hexagon workbench settings, per pattern id. */
  hex: {},
};

try {
  const saved = JSON.parse(localStorage.getItem('quiltblock:prefs') || '{}');
  for (const k of REMEMBERED) if (saved[k] != null) state[k] = saved[k];
} catch { /* private window, blocked storage - defaults are fine */ }

function remember() {
  try {
    const out = {};
    for (const k of REMEMBERED) out[k] = state[k];
    localStorage.setItem('quiltblock:prefs', JSON.stringify(out));
  } catch { /* not important enough to bother the user about */ }
}

/** Definitions by id, including anything the generator has produced this session. */
const DEFS = new Map([...LIBRARY, ...HEXAGON_LIBRARY].map((d) => [d.id, d]));

const isHex = (def) => def?.kind === 'hexagon';

/** The block size to use for a definition: the user's choice if the grid allows it. */
function sizeFor(def, wanted = state.blockSize) {
  const grid = String(def.rows[0]).trim().split(/\s+/).length;
  const ok = (s) => inches(s) % grid === 0;
  if (ok(wanted)) return wanted;
  if (def.blockSize && ok(def.blockSize)) return def.blockSize;
  for (const s of [12, 10, 16, 18, 9, 15, 8, 6, 20, 24]) if (ok(s)) return s;
  return wanted;
}

function patternFor(id, opts = {}) {
  const def = DEFS.get(id);
  if (!def || isHex(def)) return null;
  return makePattern(def, {
    seam: state.seam,
    trim: state.trim,
    corners: state.corners,
    colorway: state.colorway,
    ...opts,
    blockSize: opts.blockSize ?? sizeFor(def),
  });
}

const priceOf = (p) =>
  p.def.custom ? PRICING.custom : p.block.blockSize <= 10 ? PRICING.block10 : PRICING.block12;

const tierBadge = (tier) => `<span class="badge tier-${tier.id}">${esc(tier.short ?? tier.name)}</span>`;

/* ------------------------------------------------------------------- home */

const HOUSE_RULES = [
  ['01', 'Straight lines only', 'Horizontal, vertical, or a true 45° diagonal. Nothing you cannot rotary-cut against a ruler.'],
  ['02', 'The seam is a setting', 'Scant ¼" by default, but ⅛" for a doll quilt or ½" for flannel. Every cut size is derived, never looked up.'],
  ['03', 'Every piece labelled', 'A, B, C in reading order, grouped by fabric, with the cut size next to it and a pressing arrow on the diagram.'],
  ['04', 'Complexity is a dial', 'Beginner to advanced is a score computed from the geometry: pieces, bias edges, tiny bits. The label cannot lie.'],
];

const LEVEL_EXAMPLES = { beginner: 'nine-patch', confident: 'teapot', intermediate: 'dutchmans-puzzle', advanced: 'lady-of-the-lake' };

function renderHome() {
  const hero = patternFor('teapot');
  $('#hero-block').innerHTML = hero.svg({ scale: 2.4 });
  $('#house-rules').innerHTML = HOUSE_RULES.map(
    ([n, h, b]) => `<div class="rule-card"><span class="n">${n}</span><h3>${h}</h3><p class="muted">${b}</p></div>`,
  ).join('');
  $('#levels').innerHTML = TIER_ORDER.map((id) => {
    const t = TIERS[id];
    const p = patternFor(LEVEL_EXAMPLES[id]);
    return `<button class="level tier-${id}" data-open-tier="${id}">
      <div class="thumb">${p.svg({ labels: false, scale: 1 })}</div>
      <div class="meta">
        <span class="name">${esc(t.name)}</span>
        <span class="sub">${esc(t.blurb)}</span>
        <span class="eyebrow">${esc(p.def.name)} · ${p.block.pieces.length} pieces</span>
      </div>
    </button>`;
  }).join('');
  $('#featured').innerHTML = ['teacup', 'chicken', 'maple-leaf', 'sawtooth-star']
    .map((id) => cardHtml(patternFor(id)))
    .join('');
}

function cardHtml(p) {
  const counts = unitCounts(p.block);
  const kinds = [
    counts.corners && `${counts.corners} corners`,
    counts.hst && `${counts.hst} HST`,
    counts.qst && `${counts.qst} hourglass`,
    counts.geese && `${counts.geese} geese`,
  ].filter(Boolean);
  return `<button class="card" data-open="${p.def.id}" aria-label="Open ${esc(p.def.name)}">
    <div class="thumb">${p.svg({ labels: false, scale: 1.3 })}</div>
    <div class="meta">
      <div class="row-between"><span class="name">${esc(p.def.name)}</span><span class="price">$${priceOf(p)}</span></div>
      <span class="sub">${tierBadge(p.tier)} ${esc(p.def.subject)} &middot; ${p.block.pieces.length} pieces${kinds.length ? ' &middot; ' + kinds.join(', ') : ''}</span>
    </div>
  </button>`;
}

function hexCardHtml(def) {
  const plan = planHexagons(hexOptsFor(def));
  return `<button class="card" data-open="${def.id}" aria-label="Open ${esc(def.name)}">
    <div class="thumb">${hexagonsSvg(plan, { scale: 6 })}</div>
    <div class="meta">
      <div class="row-between"><span class="name">${esc(def.name)}</span><span class="price">$${PRICING.hexagon}</span></div>
      <span class="sub"><span class="badge tier-hand">Hand piecing</span> ${plan.count} hexies &middot; ${esc(plan.finished.label)}</span>
    </div>
  </button>`;
}

/* --------------------------------------------------------------- catalogue */

let filter = 'All';
let tierFilter = 'all';

function renderCatalog() {
  const subjects = ['All', ...SUBJECTS];
  $('#filters').innerHTML = subjects
    .map((s) => `<button class="chip" data-filter="${esc(s)}" aria-pressed="${s === filter}">${esc(s)}</button>`)
    .join('');
  $('#tier-filters').innerHTML = [['all', 'Every level'], ...TIER_ORDER.map((id) => [id, TIERS[id].name])]
    .map(([id, name]) => `<button class="chip tier-${id}" data-tier="${id}" aria-pressed="${id === tierFilter}">${esc(name)}</button>`)
    .join('');

  const blocks = LIBRARY.filter((d) => filter === 'All' || d.subject === filter)
    .map((d) => patternFor(d.id))
    .filter((p) => tierFilter === 'all' || p.tier.id === tierFilter);
  const hexes = tierFilter === 'all' ? HEXAGON_LIBRARY.filter((d) => filter === 'All' || d.subject === filter) : [];
  $('#catalog').innerHTML =
    blocks.map(cardHtml).join('') + hexes.map(hexCardHtml).join('') ||
    `<p class="muted">Nothing at that level under that subject yet. Try “Make your own”.</p>`;
}

/* ------------------------------------------------------------------ detail */

function fillSelect(sel, entries, value) {
  sel.innerHTML = entries
    .map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

function renderDetail() {
  const def = DEFS.get(state.blockId);
  if (!def) return;
  if (isHex(def)) {
    renderHex(def);
    return;
  }
  const p = patternFor(state.blockId);
  if (!p) return;

  $('#d-subject').innerHTML = `${esc(p.def.subject)}${p.def.custom ? ' · generated' : ''} ${tierBadge(p.tier)}`;
  $('#d-name').textContent = p.def.name;
  $('#d-blurb').textContent = p.def.blurb ?? '';

  fillSelect(
    $('#f-seam'),
    Object.values(SEAM_PROFILES).map((s) => [s.id, s.recommended ? `${s.name} — recommended` : s.name]),
    state.seam,
  );
  fillSelect(
    $('#f-trim'),
    Object.values(TRIM_STYLES).map((t) => [t.id, t.recommended ? `${t.name} — recommended` : t.name]),
    state.trim,
  );
  fillSelect($('#f-size'), p.sizes.map((s) => [s, `${s}" finished`]), p.block.blockSize);
  fillSelect(
    $('#f-corners'),
    Object.values(CORNER_METHODS).map((c) => [c.id, c.recommended ? `${c.name} — recommended` : c.name]),
    state.corners,
  );
  fillSelect($('#f-colorway'), COLORWAYS.map((c) => [c.id, c.name]), state.colorway);
  $('#f-method').value = state.method;

  const seam = SEAM_PROFILES[state.seam];
  const cm = CORNER_METHODS[state.corners];
  $('#seam-note').textContent = `${seam.note} ${p.math.describe()} · ${cm.blurb}`;

  // facts
  const counts = unitCounts(p.block);
  $('#d-facts').innerHTML = [
    ['Finished', `${p.block.blockSize}"`],
    ['Pieces', p.block.pieces.length],
    ['Units', p.block.units.length],
    ['Seams', p.plan.seams.length],
    ['Level', p.difficulty.level],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`)
    .join('');

  // diagram
  const q = state.preview === 'quilt' ? quiltFor(p) : null;
  if (state.preview === 'quilt') {
    $('#d-svg').innerHTML = q.svg({ scale: 0.6 });
  } else if (state.preview === 'press') {
    $('#d-svg').innerHTML = p.svg({ scale: 2.4, overlay: 'pressing', plan: p.plan });
  } else if (state.preview === 'exploded') {
    $('#d-svg').innerHTML = p.exploded({ scale: 2.4, gap: 10, labels: true });
  } else if (state.preview === 'coloring') {
    $('#d-svg').innerHTML = p.coloring({ scale: 2.4 });
  } else {
    $('#d-svg').innerHTML = p.svg({ scale: 2.4 });
  }
  for (const m of ['block', 'exploded', 'press', 'quilt', 'coloring']) {
    $(`#mode-${m}`).setAttribute('aria-pressed', String(state.preview === m));
  }

  $('#d-legend').innerHTML =
    state.preview === 'press'
      ? `<div class="legend">
          <span><i></i> pressed this way, so seams nest</span>
          <span><i class="open"></i> pressed open</span>
          <span><i class="dot"></i> four or more seams meet here</span>
          <span>dashed outline = one sewn unit</span>
        </div>`
      : state.preview === 'exploded'
        ? `<div class="legend"><span>Units pulled apart along the seams that join them. Dashed outline = one sewn unit.</span></div>`
        : state.preview === 'quilt'
          ? `<div class="legend"><span>${esc(q.finished.label)} · ${q.counts.pieced} blocks · ${esc(q.setting.name)}. Change it in the planner below.</span></div>`
          : '';

  $('#d-swatches').innerHTML = p.cutting.fabrics
    .map(
      (f) =>
        `<div class="swatch"><i style="background:${f.hex}"></i><span>${esc(f.name)}</span>` +
        `<span class="muted">&middot; ${f.pieceCount} piece${f.pieceCount === 1 ? '' : 's'} &middot; <span class="num">${esc(f.yardage.label)}</span> for one block</span></div>`,
    )
    .join('');

  $('#d-tally').innerHTML = [
    ['Patches', counts.patch - counts.flip],
    ['Stitch & flip', counts.flip],
    ['Half-square', counts.hst],
    ['Hourglass', counts.qst],
    ['Flying geese', counts.geese],
    ['Pressed open', p.plan.pressOpenCount],
  ]
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v num">${v}</span></div>`)
    .join('');

  renderUnits(p);
  $('#d-price').textContent = `$${priceOf(p)}`;

  renderSeamPanel(p);
  renderCuts(p);
  renderOrder(p);
  renderPlanner(p);
}

/** "Make 8 of these": one line per kind of sewn unit, with a picture. */
function renderUnits(p) {
  const groups = p.plan.unitGroups;
  if (!groups.length) {
    $('#d-units').innerHTML = `<h4>Units to make</h4><p class="muted" style="font-size:.88rem">Nothing to pre-sew: this block is plain patches joined in rows.</p>`;
    return;
  }
  $('#d-units').innerHTML = `<h4>Units to make first</h4>
    <div class="units">${groups
      .map(
        (g) => `<div class="unit">
          <div class="unit-pic">${p.unitSvg(g.sample, { scale: 2 })}</div>
          <div>
            <strong>Make ${g.count} ${esc(g.name)}</strong>
            <span class="muted">${esc(g.finished)} finished, ${esc(g.unfinished)} with seams · pieces ${esc(g.labels.join(', '))}</span>
          </div>
        </div>`,
      )
      .join('')}</div>`;
}

function renderSeamPanel(p) {
  const counts = unitCounts(p.block);
  const constructions = [
    counts.patch - counts.flip > 0 && ['Plain patches', `${counts.patch - counts.flip} rectangles, cut at the finished size plus ${fmt(p.math.allowance * 2)}.`],
    counts.flip && ['Stitch-and-flip corners', `${counts.corners} corners on ${counts.flip} rectangle${counts.flip === 1 ? '' : 's'}. A small square laid on the corner, sewn across, trimmed, flipped. No triangle is ever cut.`],
    counts.hst && ['Half-square triangles', `${counts.hst} units. Two squares, one diagonal, sewn either side and cut apart.`],
    counts.qst && ['Hourglass units', `${counts.qst} units. Two half-square triangles crossed and cut on the other diagonal.`],
    counts.geese && ['Flying geese', `${counts.geese} units, built no-waste: one big square, four small, four geese.`],
  ].filter(Boolean);

  const warn = p.plan.needsPartialSeam
    ? `<div class="callout flag"><strong>This block needs a partial seam.</strong>
        <span>Part of one seam is sewn, the neighbouring pieces go on, then you come back
        and finish it. It is the one fiddly step in the pattern and the instructions
        walk through it.</span></div>`
    : `<div class="callout"><strong>No partial seams, no set-in Y-seams.</strong>
        <span>Every seam runs edge to edge across whatever is already sewn, so the whole
        block goes together in straight lines.</span></div>`;

  const bulk = p.plan.bulk.length
    ? `<p class="muted" style="font-size:.88rem">${p.plan.bulk.length} intersection${p.plan.bulk.length === 1 ? '' : 's'}
       where four or more pieces meet. Those are circled on the pressing diagram and their
       seams are pressed open so the block stays flat.</p>`
    : '';

  $('#d-seams').innerHTML = `
    <h3>Seams in this block</h3>
    <p class="muted" style="margin:6px 0 14px">${esc(p.plan.summary)}</p>
    ${warn}
    <div class="tablewrap">
      <table class="spec">
        <thead><tr><th>Construction</th><th>How it is built</th></tr></thead>
        <tbody>${constructions
          .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td class="muted">${esc(v)}</td></tr>`)
          .join('')}</tbody>
      </table>
    </div>
    ${bulk}`;
}

function cutRowsHtml(fabrics, { showLabels = true } = {}) {
  return fabrics
    .map((f) =>
      f.entries
        .map(
          (e, i) => `<tr${i === 0 ? ' class="fabric-start"' : ''}>
            <td>${
              i === 0
                ? `<span class="fab"><i style="background:${f.hex}"></i>${esc(f.name)}</span>` +
                  `<span class="yardage num">${esc(f.yardage.label)}</span>`
                : ''
            }</td>
            <td class="qty">${e.qty}</td>
            <td class="num">${esc(e.cut)}</td>
            <td class="muted">${esc(e.purpose)}${
              e.yields ? `<br><span style="font-size:.85em">${esc(e.yields)}${e.spare ? `, ${e.spare} spare` : ''}</span>` : ''
            }</td>
            ${showLabels ? `<td class="muted num" style="font-size:.85em">${esc(e.labels.join(', '))}</td>` : ''}
          </tr>`,
        )
        .join(''),
    )
    .join('');
}

function renderCuts(p) {
  if (state.method === 'fpp') {
    const f = p.foundation();
    $('#d-cuts').innerHTML = `
      <table class="spec"><caption>Rough-cut list &mdash; foundation paper piecing</caption>
      <thead><tr><th>Fabric</th><th class="qty">Piece</th><th>Rough cut at least</th></tr></thead>
      <tbody>${f.cutting
        .map((g) =>
          g.pieces
            .map(
              (pc, i) =>
                `<tr${i === 0 ? ' class="fabric-start"' : ''}><td>${
                  i === 0 ? `<span class="fab"><i style="background:${g.hex}"></i>${esc(g.name)}</span>` : ''
                }</td><td class="qty">${pc.number}</td><td class="num">${esc(pc.rough)}</td></tr>`,
            )
            .join(''),
        )
        .join('')}</tbody></table>
      <div class="callout" style="margin-top:14px"><strong>${f.sections.length} foundation section${
        f.sections.length === 1 ? '' : 's'
      } (${f.sections.map((s) => s.id).join(', ')}).</strong>
        <span>Printed mirrored, because you sew on the back of the paper. Rough cuts only have
        to cover their numbered area plus the seam allowance &mdash; trim to the line as you go.</span></div>`;
    return;
  }

  $('#d-cuts').innerHTML = `
    <div class="tablewrap">
      <table class="spec">
        <caption>Cutting list &mdash; one block, ${esc(p.math.seam.name)} seam</caption>
        <thead><tr><th>Fabric</th><th class="qty">Cut</th><th>Size</th><th>For</th><th>Pieces</th></tr></thead>
        <tbody>${cutRowsHtml(p.cutting.fabrics)}</tbody>
      </table>
    </div>
    <p class="muted" style="font-size:.84rem;margin-top:8px">Yardage per block is planned as width-of-fabric
      strips. The quilt planner below totals it for the whole quilt.</p>`;
}

function renderOrder(p) {
  const f = state.method === 'fpp' ? p.foundation() : null;
  const steps = f
    ? f.instructions.map((t) => ({ text: t }))
    : [...p.plan.steps];

  const pressing = state.method === 'fpp'
    ? ''
    : `<h3 style="margin-top:26px">Pressing</h3>
       <div class="tablewrap"><table class="spec">
         <thead><tr><th>Seam</th><th>Press</th><th>Why</th></tr></thead>
         <tbody>${p.plan.seams
           .filter((s) => s.type === 'straight')
           .map(
             (s, i) =>
               `<tr><td class="num">${i + 1}. ${s.orientation}</td>
                <td><strong>${esc(s.press)}</strong></td>
                <td class="muted">${esc(s.reason)}${s.note ? ` <span style="font-size:.9em">${esc(s.note)}</span>` : ''}</td></tr>`,
           )
           .join('')}</tbody></table></div>`;

  $('#d-order').innerHTML = `
    <h3 style="margin-top:26px">Sew order</h3>
    <ol class="steps-list" style="margin-top:12px">
      ${steps.map((s) => `<li${s.phase === 'units' ? ' class="unit-step"' : ''}>${esc(s.text)}</li>`).join('')}
    </ol>
    ${pressing}`;
}

/* ------------------------------------------------------------ the planner */

const QUILT_DEFAULTS = {
  preset: 'custom',
  cols: 4,
  rows: 5,
  setting: 'straight',
  sashing: 2,
  innerBorder: 0,
  outerBorder: 4,
  mirror: false,
  rainbow: false,
  piecedBorder: false,
};

function quiltOptsFor(def) {
  if (!state.quilt[def.id]) state.quilt[def.id] = { ...QUILT_DEFAULTS, ...(def.quilt ?? {}) };
  return state.quilt[def.id];
}

function quiltFor(p) {
  const o = quiltOptsFor(p.def);
  return p.quilt({
    cols: o.cols,
    rows: o.rows,
    setting: o.setting,
    sashing: o.sashing,
    innerBorder: o.innerBorder,
    outerBorder: o.outerBorder,
    mirror: o.mirror,
    rainbow: o.rainbow,
    piecedBorder: o.piecedBorder,
  });
}

function renderPlanner(p) {
  const o = quiltOptsFor(p.def);
  const q = quiltFor(p);

  fillSelect($('#q-preset'), [['custom', 'Custom'], ...QUILT_SIZES.map((s) => [s.id, `${s.name} · about ${s.w}" × ${s.h}"`])], o.preset);
  const range = (n) => Array.from({ length: n }, (_, i) => [i + 1, String(i + 1)]);
  fillSelect($('#q-cols'), range(12), o.cols);
  fillSelect($('#q-rows'), range(14), o.rows);
  fillSelect($('#q-setting'), Object.values(SETTINGS).map((s) => [s.id, s.name]), o.setting);
  $('#q-sashing').value = String(o.sashing);
  $('#q-inner').value = String(o.innerBorder);
  $('#q-outer').value = String(o.outerBorder);
  $('#q-mirror').checked = o.mirror;
  $('#q-rainbow').checked = o.rainbow;
  $('#q-pieced').checked = o.piecedBorder;
  $('#q-sashing').disabled = !(o.setting === 'sashed' || o.setting === 'cornerstones');
  $('#q-pieced').disabled = !o.outerBorder;

  $('#q-size-line').textContent = `${q.finished.label} · closest to a ${q.sizeName.name.toLowerCase()}`;
  $('#q-note').textContent =
    `${SETTINGS[o.setting].blurb} ` +
    (q.mini ? `The outer border is ${fmt(q.outerBorder)} so a ${q.mini.inches}" block fits in it exactly. ` : '') +
    (q.rainbow ? `The background changes block by block, so it is bought as ${q.cutting.filter((f) => f.fabric.startsWith('rainbow')).length} fat quarters or so instead of one fabric.` : '');

  $('#q-svg').innerHTML = q.svg({ scale: 0.6 });

  const total = q.cutting.reduce((s, f) => s + (f.yardage.yards ?? 0.25), 0);
  $('#q-fabrics').innerHTML = `
    <div class="tablewrap">
      <table class="spec">
        <caption>Fabric requirements &mdash; ${q.counts.pieced} block${q.counts.pieced === 1 ? '' : 's'}${q.counts.minis ? ` + ${q.counts.minis} border blocks` : ''}, ${esc(q.finished.label)}</caption>
        <thead><tr><th>Fabric</th><th class="qty">Buy</th><th>Cut as strips</th><th>For</th></tr></thead>
        <tbody>${q.cutting
          .map(
            (f) => `<tr class="fabric-start">
              <td><span class="fab"><i style="background:${f.hex}"></i>${esc(f.name)}</span></td>
              <td class="qty">${esc(f.yardage.label)}</td>
              <td class="num" style="font-size:.85em">${f.strips.strips.map((s) => `${s.count} × ${esc(s.widthLabel)}`).join(', ')}</td>
              <td class="muted" style="font-size:.85em">${esc([...new Set(f.entries.map((e) => e.purpose))].join('; '))}</td>
            </tr>`,
          )
          .join('')}
          <tr><td><strong>Backing</strong></td><td class="qty">${esc(q.backing.yardage.label)}</td><td class="num" style="font-size:.85em">${q.backing.panels} panel${q.backing.panels === 1 ? '' : 's'}, ${esc(q.backing.wideback.label)} of 108" wideback</td><td class="muted" style="font-size:.85em">${esc(q.backing.label)}</td></tr>
          <tr><td><strong>Batting</strong></td><td class="qty">—</td><td class="num" style="font-size:.85em">${esc(q.batting.label)}</td><td class="muted" style="font-size:.85em">crib, throw or twin size as sold</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted" style="font-size:.84rem;margin-top:8px">About ${total.toFixed(1)} yards for the top and binding, planned as ${fmt(q.cutting[0]?.strips.usable ?? inches(40))}-wide strips off the bolt, rounded up to the next eighth.</p>`;

  $('#q-cuts').innerHTML = `
    <div class="tablewrap">
      <table class="spec">
        <caption>Cutting list &mdash; the whole quilt</caption>
        <thead><tr><th>Fabric</th><th class="qty">Strips</th><th>Then cut</th></tr></thead>
        <tbody>${q.cutting
          .map((f) =>
            f.strips.strips
              .map(
                (s, i) => `<tr${i === 0 ? ' class="fabric-start"' : ''}>
                  <td>${i === 0 ? `<span class="fab"><i style="background:${f.hex}"></i>${esc(f.name)}</span>` : ''}</td>
                  <td class="qty">(${s.count}) ${esc(s.widthLabel)} × WOF${s.pieced ? '<br><span style="font-size:.8em;font-family:var(--ff-body)">' + esc(s.pieced.note) + '</span>' : ''}</td>
                  <td class="muted" style="font-size:.9em">${s.subcuts
                    .map((c) => `(${c.qty}) <span class="num">${esc(c.cut)}</span> — ${esc(c.purpose)}`)
                    .join('<br>')}</td>
                </tr>`,
              )
              .join(''),
          )
          .join('')}</tbody>
      </table>
    </div>`;

  $('#q-steps').innerHTML = `
    <h3 style="margin-top:26px">Putting the quilt together</h3>
    <ol class="steps-list" style="margin-top:12px">${q.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
}

/* ----------------------------------------------------------- hexagons ---- */

const HEX_DIMS = [12, 16, 18, 20, 24, 30, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 90];

function hexOptsFor(def) {
  if (!state.hex[def.id]) state.hex[def.id] = { side: def.side, layout: def.layout, width: def.width, height: def.height };
  return state.hex[def.id];
}

function hexPlanFor(def) {
  return planHexagons({ ...def, ...hexOptsFor(def) });
}

function renderHex(def) {
  const o = hexOptsFor(def);
  const plan = hexPlanFor(def);
  $('#h-subject').innerHTML = `${esc(def.subject)} <span class="badge tier-hand">English paper piecing</span>`;
  $('#h-name').textContent = def.name;
  $('#h-blurb').textContent = def.blurb ?? '';

  fillSelect($('#h-side'), HEX_SIZES.map((s) => [s.side, s.recommended ? `${s.name} — the classic` : s.name]), o.side);
  fillSelect($('#h-layout'), Object.values(HEX_LAYOUTS).map((l) => [l.id, l.name]), o.layout);
  fillSelect($('#h-width'), HEX_DIMS.map((d) => [d, `about ${d}"`]), o.width);
  fillSelect($('#h-height'), HEX_DIMS.map((d) => [d, `about ${d}"`]), o.height);
  $('#h-note').textContent = `${HEX_LAYOUTS[o.layout].blurb} A ${fmt(inches(o.side))} side means ${fmt(inches(Math.round(plan.geometry.acrossFlats * 16) / 16))} across the flats; each hexie is cut from a ${fmt(inches(plan.geometry.cutSquare))} square.`;

  $('#h-svg').innerHTML = hexagonsSvg(plan, { scale: 10 });
  $('#h-swatches').innerHTML = plan.cutting
    .map((f) => `<div class="swatch"><i style="background:${f.hex}"></i><span>${esc(f.name)}</span><span class="muted">&middot; ${f.count} hexies &middot; <span class="num">${esc(f.yardage.label)}</span></span></div>`)
    .join('');
  $('#h-facts').innerHTML = [
    ['Finished', plan.finished.label],
    ['Hexagons', plan.count],
    ['Papers', plan.papers],
    ['Hours, about', plan.hours],
    ['Level', 'Patient'],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`)
    .join('');
  $('#h-tally').innerHTML = [
    ['Rows', plan.rows],
    ['Across', plan.cols],
    ['Fabrics', plan.cutting.length],
  ]
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v num">${v}</span></div>`)
    .join('');
  $('#h-price').textContent = `$${PRICING.hexagon}`;

  $('#h-cuts').innerHTML = `
    <div class="tablewrap">
      <table class="spec">
        <caption>Cutting list &mdash; ${plan.count} hexagons, ${fmt(inches(o.side))} side</caption>
        <thead><tr><th>Fabric</th><th class="qty">Hexies</th><th>Cut</th><th>Strips</th><th class="qty">Buy</th></tr></thead>
        <tbody>${plan.cutting
          .map(
            (f) => `<tr class="fabric-start">
              <td><span class="fab"><i style="background:${f.hex}"></i>${esc(f.name)}</span></td>
              <td class="qty">${f.count}</td>
              <td class="num">${esc(f.cut)}</td>
              <td class="muted" style="font-size:.85em">(${f.strips}) ${esc(fmt(f.stripWidth))} × WOF, ${f.perStrip} per strip</td>
              <td class="qty">${esc(f.yardage.label)}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>`;
  $('#h-steps').innerHTML = `
    <h3 style="margin-top:26px">How it goes together</h3>
    <ol class="steps-list" style="margin-top:12px">${plan.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
}

/* ------------------------------------------------------------ custom flow */

let generating = false;

function renderTierControls() {
  fillSelect($('#f-tier'), TIER_ORDER.map((id) => [id, TIERS[id].name]), $('#f-tier').value || DEFAULT_TIER);
  const tier = TIERS[$('#f-tier').value];
  const current = Number($('#f-grid').value);
  fillSelect(
    $('#f-grid'),
    tier.grids.map((g) => [g, `${g} × ${g}${g === tier.grids[0] ? ' — coarse' : g === tier.grids[tier.grids.length - 1] ? ' — fine' : ''}`]),
    tier.grids.includes(current) ? current : tier.grids[1] ?? tier.grids[0],
  );
  $('#tier-note').textContent = `${tier.blurb} Aims for ${tier.pieces[0]}–${tier.pieces[1]} pieces.`;
}

async function runGenerate(prompt) {
  if (generating) return;
  generating = true;
  const steps = $$('#progress li');
  steps.forEach((li) => li.classList.remove('on', 'done'));
  $('#generate').disabled = true;
  $('#gen-error').innerHTML = '';
  $('#result').hidden = true;
  $('#stage-empty').hidden = false;
  $('#stage-empty').textContent = `Working on “${prompt}”…`;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0;
  const tick = setInterval(() => {
    if (i > 0) steps[i - 1]?.classList.replace('on', 'done');
    if (i < steps.length) steps[i++].classList.add('on');
  }, reduced ? 60 : 520);

  try {
    const photo = await readPhoto($('#prompt-photo').files?.[0]);
    const tier = $('#f-tier').value;
    const result = await generate({
      prompt,
      photo,
      fabricLimit: Number($('#f-fabrics').value),
      gridSize: Number($('#f-grid').value),
      blockSize: state.blockSize,
      tier,
    });

    const def = { ...result.block, custom: true };
    DEFS.set(def.id, def);
    const p = makePattern(def, { seam: state.seam, trim: state.trim, corners: state.corners, blockSize: sizeFor(def) });
    state.generated = def.id;

    clearInterval(tick);
    steps.forEach((li) => { li.classList.remove('on'); li.classList.add('done'); });

    $('#stage-empty').hidden = true;
    $('#result').hidden = false;
    $('#r-svg').innerHTML = p.svg({ scale: 2.4 });
    $('#r-name').innerHTML = `${esc(def.name)} ${tierBadge(p.tier)}`;
    const counts = unitCounts(p.block);
    $('#r-facts').textContent =
      `${p.block.blockSize}" block · ${p.block.pieces.length} pieces · ` +
      `${p.block.fabricsUsed.length} fabrics · ${p.difficulty.level}. ` +
      `${counts.patch - counts.flip} patches, ${counts.corners} stitch-and-flip corners, ${counts.hst} half-square triangles, ${counts.qst} hourglass, ${counts.geese} flying geese.`;
    $('#r-swatches').innerHTML = p.cutting.fabrics
      .map((f) => `<div class="swatch"><i style="background:${f.hex}"></i><span>${esc(f.name)}</span></div>`)
      .join('');
    $('#r-checks').innerHTML = checksHtml(p, result, tier);
    $('#r-open').onclick = () => { location.hash = `pattern/${def.id}`; };
  } catch (err) {
    clearInterval(tick);
    steps.forEach((li) => li.classList.remove('on', 'done'));
    $('#stage-empty').hidden = false;
    $('#stage-empty').textContent = 'That one did not come out. Try describing it a different way.';
    $('#gen-error').innerHTML = `<div class="callout flag" style="margin-top:12px">
      <strong>${esc(err instanceof GenerateError ? 'The block came back breaking a rule.' : 'The generator could not be reached.')}</strong>
      <span>${esc(err.message)}</span></div>`;
  } finally {
    $('#generate').disabled = false;
    generating = false;
  }
}

function checksHtml(p, result, tier) {
  const v = p.validation;
  const lines = [
    ['Straight lines only', !v.errors.some((e) => e.rule === 'straight-lines')],
    ['Pieces fill the block exactly', !v.errors.some((e) => e.rule === 'covers-block')],
    ['Nothing too small to sew', !v.errors.some((e) => e.rule === 'min-size')],
    ['Piece count in range', !v.errors.some((e) => e.rule === 'pieces')],
    ['Every piece labelled', !v.errors.some((e) => e.rule === 'labels')],
    [`Lands at ${TIERS[tier]?.name ?? 'the asked-for level'}`, p.tier.id === tier || result?.mock],
  ];
  return `<div class="panel">
    <h4>Checked against the house rules</h4>
    <div class="stack" style="gap:5px;font-size:.88rem">
      ${lines
        .map(
          ([label, ok]) =>
            `<div><span style="color:${ok ? 'var(--good)' : 'var(--flag)'};font-weight:700">${ok ? '✓' : '✗'}</span> ${label}</div>`,
        )
        .join('')}
    </div>
    ${v.warnings.length ? `<p class="muted" style="font-size:.84rem">${v.warnings.map((w) => esc(w.message)).join(' ')}</p>` : ''}
    ${result?.mock ? `<p class="muted" style="font-size:.84rem"><strong>Stand-in generator.</strong> ${esc(result.notes ?? '')}</p>` : ''}
  </div>`;
}

function readPhoto(file) {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ media_type: file.type, data: String(reader.result).split(',')[1] });
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------- checkout */

function cartItem() {
  const def = DEFS.get(state.cart ?? state.blockId);
  if (!def) return null;
  if (isHex(def)) return { def, name: def.name, price: PRICING.hexagon, detail: `${planHexagons({ ...def, ...hexOptsFor(def) }).count} hexagons` };
  const p = patternFor(def.id);
  return { def, name: def.name, price: priceOf(p), detail: `${p.block.blockSize}" block, ${p.math.seam.name} seam` };
}

function renderCheckout() {
  const item = cartItem();
  if (!item) return;

  $('#order-summary').innerHTML = `
    <h3 style="font-size:1rem">${esc(item.name)}</h3>
    <div class="line-items" id="lines"></div>`;

  $('#fulfilment-opts').innerHTML = FULFILMENT.map(
    (f) => `<button class="opt" data-ful="${f.id}" aria-pressed="${f.id === state.fulfilment}">
      <span class="t"><strong>${esc(f.name)}</strong><span class="price">${f.price ? money(f.price) : 'included'}</span></span>
      <span class="muted" style="font-size:.88rem">${esc(f.blurb)}</span>
      <span class="eyebrow">${esc(f.eta)}${f.real ? '' : ' · mocked'}</span>
    </button>`,
  ).join('');

  $('#payment-methods').innerHTML = DEMO_CARDS.map(
    (c) => `<label><input type="radio" name="card" value="${c.id}"${c.id === state.card ? ' checked' : ''}>
      <span>${esc(c.brand)} &middot; ${esc(c.label)}</span>
      <span class="cardno">•••• ${c.last4}</span></label>`,
  ).join('');

  renderLines(item);
  renderFulfilmentDetail();
}

function renderLines(item) {
  const f = FULFILMENT.find((x) => x.id === state.fulfilment) ?? FULFILMENT[0];
  const subtotal = item.price;
  const tax = Math.round((subtotal + f.price) * 0.07 * 100) / 100;
  $('#lines').innerHTML = `
    <div><span>Pattern PDF &mdash; ${esc(item.detail)}</span><span class="num">${money(subtotal)}</span></div>
    <div><span>${esc(f.name)}</span><span class="num">${f.price ? money(f.price) : '—'}</span></div>
    <div><span>Estimated tax</span><span class="num">${money(tax)}</span></div>
    <div class="total"><span>Total</span><span class="num">${money(subtotal + f.price + tax)}</span></div>`;
}

function renderFulfilmentDetail() {
  const el = $('#fulfilment-detail');
  if (state.fulfilment === 'find-printer') {
    el.innerHTML = `
      <div class="field" style="margin-top:12px;max-width:220px">
        <label for="f-post">Postcode</label>
        <input type="number" id="f-post" placeholder="83001">
      </div>
      <button class="btn ghost" id="find-shops" style="margin-top:10px">Find print shops</button>
      <div id="shop-results" style="margin-top:12px"></div>`;
  } else if (state.fulfilment === 'mail-print') {
    el.innerHTML = `<div class="callout" style="margin-top:12px">
      <strong>Mocked.</strong>
      <span>A real version would hand the PDF to a print partner's API, take a shipping
      address, and return a tracking number. Nothing is submitted here and no address is collected.</span></div>`;
  } else {
    el.innerHTML = `<div class="callout" style="margin-top:12px">
      <strong>This part is real.</strong>
      <span>The printable pattern is generated in the browser from the same engine &mdash;
      open it from the pattern page and print at 100%.</span></div>`;
  }
}

async function placeOrder() {
  const item = cartItem();
  const btn = $('#place-order');
  btn.disabled = true;
  btn.textContent = 'Pretending to charge the card…';
  const order = await checkout({
    items: [{ name: item.name, price: item.price }],
    fulfilment: FULFILMENT.find((f) => f.id === state.fulfilment),
    method: state.card,
  });
  btn.disabled = false;
  btn.textContent = 'Place the (pretend) order';
  $('#order-result').innerHTML = `<div class="callout" style="margin-top:16px">
    <strong>Order ${esc(order.orderId)} — not a real order.</strong>
    <span>${money(order.total)} would have gone to ${esc(order.method.brand)} •••• ${esc(order.method.last4)}.
    No money moved and no card was charged, because no card exists.</span>
    <span style="margin-top:6px"><a href="#print/${esc(item.def.id)}">Open the printable pattern &rarr;</a></span>
  </div>`;
}

/* ----------------------------------------------------------- print view */

function renderPrint() {
  const def = DEFS.get(state.blockId);
  if (!def) return;
  if (isHex(def)) {
    renderHexPrint(def);
    return;
  }
  const p = patternFor(state.blockId);
  if (!p) return;
  const f = state.method === 'fpp' ? p.foundation() : null;
  const q = quiltFor(p);

  $('#print-body').innerHTML = `
    <div class="row-between" style="align-items:flex-start">
      <div>
        <div class="eyebrow">QuiltBlock Studio</div>
        <h1 style="font-size:2rem;margin:4px 0">${esc(p.def.name)}</h1>
        <p class="num">${p.block.blockSize}" finished block &middot; ${p.block.pieces.length} pieces &middot;
          ${esc(p.math.seam.name)} seam &middot; ${esc(p.difficulty.level)} &middot; quilt ${esc(q.finished.label)}, ${q.counts.pieced} blocks</p>
      </div>
      <div class="test-square">1 inch<br>check me</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px">
      <div>${p.svg({ scale: 1.7 })}</div>
      <div>${q.svg({ scale: 0.5 })}
        <p style="font-size:.8rem">${esc(q.setting.name)}${q.innerBorder ? `, ${fmt(q.innerBorder)} inner border` : ''}${q.outerBorder ? `, ${fmt(q.outerBorder)} outer border` : ''}.</p></div>
    </div>

    <h2 style="margin-top:26px;font-size:1.3rem">Fabric requirements</h2>
    <table class="spec"><thead><tr><th>Fabric</th><th class="qty">Buy</th><th>Cut as strips</th></tr></thead>
      <tbody>${q.cutting
        .map((fab) => `<tr><td>${esc(fab.name)}</td><td class="qty">${esc(fab.yardage.label)}</td><td class="num">${fab.strips.strips.map((s) => `${s.count} × ${esc(s.widthLabel)}`).join(', ')}</td></tr>`)
        .join('')}
        <tr><td>Backing</td><td class="qty">${esc(q.backing.yardage.label)}</td><td class="num">${esc(q.backing.label)}, ${q.backing.panels} panel${q.backing.panels === 1 ? '' : 's'}</td></tr>
        <tr><td>Batting</td><td class="qty">—</td><td class="num">${esc(q.batting.label)}</td></tr>
      </tbody></table>

    <h2 style="margin-top:22px;font-size:1.3rem">Cutting</h2>
    <table class="spec"><thead><tr><th>Fabric</th><th class="qty">Strips</th><th>Then cut</th></tr></thead>
      <tbody>${q.cutting
        .map((fab) =>
          fab.strips.strips
            .map(
              (s, i) => `<tr><td>${i === 0 ? esc(fab.name) : ''}</td><td class="qty">(${s.count}) ${esc(s.widthLabel)} × WOF${s.pieced ? ' — join end to end' : ''}</td>
               <td>${s.subcuts.map((c) => `(${c.qty}) ${esc(c.cut)} — ${esc(c.purpose)}`).join('<br>')}</td></tr>`,
            )
            .join(''),
        )
        .join('')}</tbody></table>

    <div class="page-break"></div>
    <h2 style="margin-top:22px;font-size:1.3rem">The block</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:12px">
      <div>${p.exploded({ scale: 1.6, gap: 8 })}<p style="font-size:.8rem">Exploded: units pulled apart along the seams that join them.</p></div>
      <div>${p.svg({ scale: 1.6, labels: false, overlay: 'pressing', plan: p.plan })}
        <p style="font-size:.8rem">Pressing plan. Arrows show which way each seam goes;
        circles mark where four or more pieces meet.</p></div>
    </div>
    <table class="spec" style="margin-top:12px"><thead><tr><th>Fabric</th><th class="qty">Cut</th><th>Size</th><th>For</th><th>Pieces</th></tr></thead>
      <tbody>${p.cutting.fabrics
        .map((fab) =>
          fab.entries
            .map(
              (e, i) =>
                `<tr><td>${i === 0 ? esc(fab.name) : ''}</td><td class="qty">${e.qty}</td>
                 <td class="num">${esc(e.cut)}</td><td>${esc(e.purpose)}</td><td class="num">${esc(e.labels.join(', '))}</td></tr>`,
            )
            .join(''),
        )
        .join('')}</tbody></table>
    <p style="font-size:.8rem">Per block. ${esc(p.math.describe())}</p>

    <h2 style="margin-top:22px;font-size:1.3rem">Sew the block in this order</h2>
    <ol style="font-size:.9rem">${(f ? f.instructions.map((t) => ({ text: t })) : p.plan.steps)
      .map((s) => `<li>${esc(s.text)}</li>`)
      .join('')}</ol>

    <h2 style="margin-top:22px;font-size:1.3rem">Put the quilt together</h2>
    <ol style="font-size:.9rem">${q.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>

    <div class="page-break"></div>
    <h2 style="margin-top:22px;font-size:1.3rem">Coloring sheet</h2>
    <p style="font-size:.85rem">Try your own fabrics with pencils before you cut anything.</p>
    <div style="max-width:460px">${p.coloring({ scale: 1.8 })}</div>

    <p style="font-size:.78rem;margin-top:24px">Print at 100% &mdash; no "fit to page". Measure the
      1" square above with a ruler before cutting anything.</p>`;
}

function renderHexPrint(def) {
  const o = hexOptsFor(def);
  const plan = hexPlanFor(def);
  $('#print-body').innerHTML = `
    <div class="row-between" style="align-items:flex-start">
      <div>
        <div class="eyebrow">QuiltBlock Studio</div>
        <h1 style="font-size:2rem;margin:4px 0">${esc(def.name)}</h1>
        <p class="num">${plan.count} hexagons, ${esc(fmt(inches(o.side)))} side &middot; ${esc(plan.finished.label)} &middot; English paper piecing</p>
      </div>
      <div class="test-square">1 inch<br>check me</div>
    </div>
    <div style="max-width:520px;margin-top:20px">${hexagonsSvg(plan, { scale: 8 })}</div>
    <h2 style="margin-top:26px;font-size:1.3rem">Cutting</h2>
    <table class="spec"><thead><tr><th>Fabric</th><th class="qty">Hexies</th><th>Cut</th><th>Strips</th><th class="qty">Buy</th></tr></thead>
      <tbody>${plan.cutting
        .map((c) => `<tr><td>${esc(c.name)}</td><td class="qty">${c.count}</td><td class="num">${esc(c.cut)}</td><td>(${c.strips}) ${esc(fmt(c.stripWidth))} × WOF</td><td class="qty">${esc(c.yardage.label)}</td></tr>`)
        .join('')}</tbody></table>
    <h2 style="margin-top:22px;font-size:1.3rem">Sewing</h2>
    <ol style="font-size:.9rem">${plan.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="page-break"></div>
    <h2 style="margin-top:22px;font-size:1.3rem">Paper templates &mdash; print at 100%</h2>
    <p style="font-size:.85rem">Solid line is the paper, dashed square is the fabric cut. Print as many sheets as you need: ${plan.count} papers in all.</p>
    ${hexTemplateSvg(o.side, { perRow: Math.max(2, Math.floor(7 / plan.geometry.cutSquare)), count: 12 })}`;
}

/* -------------------------------------------------------------- routing */

const VIEWS = ['home', 'patterns', 'detail', 'hex', 'custom', 'checkout', 'print'];

function route() {
  const hash = location.hash.replace(/^#/, '') || 'home';
  const [head, arg] = hash.split('/');
  let view = head === 'pattern' ? 'detail' : head;
  if (!VIEWS.includes(view)) view = 'home';
  if ((head === 'pattern' || head === 'print') && arg && DEFS.has(arg)) state.blockId = arg;
  if (head === 'print') view = 'print';
  if (view === 'detail' && isHex(DEFS.get(state.blockId))) view = 'hex';

  state.view = view;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $$('nav a').forEach((a) => {
    const on = a.dataset.nav === view || ((view === 'detail' || view === 'hex') && a.dataset.nav === 'patterns');
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (view === 'patterns') renderCatalog();
  if (view === 'detail') renderDetail();
  if (view === 'hex') renderHex(DEFS.get(state.blockId));
  if (view === 'checkout') renderCheckout();
  if (view === 'print') renderPrint();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* --------------------------------------------------------------- wiring */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3400);
}

document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) { location.hash = `pattern/${open.dataset.open}`; return; }

  const openTier = e.target.closest('[data-open-tier]');
  if (openTier) { tierFilter = openTier.dataset.openTier; filter = 'All'; location.hash = 'patterns'; renderCatalog(); return; }

  const f = e.target.closest('[data-filter]');
  if (f) { filter = f.dataset.filter; renderCatalog(); return; }

  const tf = e.target.closest('[data-tier]');
  if (tf) { tierFilter = tf.dataset.tier; renderCatalog(); return; }

  const t = e.target.closest('[data-try]');
  if (t) { $('#prompt-text').value = t.dataset.try; runGenerate(t.dataset.try); return; }

  const ful = e.target.closest('[data-ful]');
  if (ful) {
    state.fulfilment = ful.dataset.ful;
    renderCheckout();
    return;
  }

  if (e.target.closest('#find-shops')) {
    const pc = $('#f-post')?.value;
    $('#shop-results').innerHTML = '<p class="muted">Looking…</p>';
    findPrinters(pc).then((r) => {
      $('#shop-results').innerHTML = `
        <div class="shops">${r.shops
          .map((s) => `<div><span><strong>${esc(s.name)}</strong> <span class="muted">${esc(s.note)}</span></span><span class="num">${esc(s.distance)}</span></div>`)
          .join('')}</div>
        <div class="callout" style="margin-top:10px"><strong>Invented shops.</strong>
          <span>${esc(r.askFor)}</span></div>`;
    });
  }
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'card') { state.card = e.target.value; return; }
});

$('#back').onclick = () => { location.hash = 'patterns'; };
$('#hex-back').onclick = () => { location.hash = 'patterns'; };
$('#checkout-back').onclick = () => history.back();
$('#print-back').onclick = () => { location.hash = `pattern/${state.blockId}`; };
$('#do-print').onclick = () => window.print();

for (const m of ['block', 'exploded', 'press', 'quilt', 'coloring']) {
  $(`#mode-${m}`).onclick = () => { state.preview = m; renderDetail(); };
}

$('#f-seam').onchange = (e) => { state.seam = e.target.value; remember(); renderDetail(); };
$('#f-trim').onchange = (e) => { state.trim = e.target.value; remember(); renderDetail(); };
$('#f-size').onchange = (e) => { state.blockSize = Number(e.target.value); remember(); renderDetail(); };
$('#f-corners').onchange = (e) => { state.corners = e.target.value; remember(); renderDetail(); };
$('#f-colorway').onchange = (e) => { state.colorway = e.target.value; remember(); renderDetail(); };
$('#f-method').onchange = (e) => { state.method = e.target.value; remember(); renderDetail(); };

// The planner: every control writes into the block's quilt settings and
// re-renders, because every number on the page depends on all of them.
const plannerChange = (mutate) => (e) => {
  const def = DEFS.get(state.blockId);
  if (!def || isHex(def)) return;
  mutate(quiltOptsFor(def), e.target);
  renderDetail();
};
$('#q-preset').onchange = plannerChange((o, el) => {
  o.preset = el.value;
  if (o.preset !== 'custom') {
    const p = patternFor(state.blockId);
    const fit = layoutFor(p.block, o.preset, o);
    o.cols = fit.cols;
    o.rows = fit.rows;
  }
});
$('#q-cols').onchange = plannerChange((o, el) => { o.cols = Number(el.value); o.preset = 'custom'; });
$('#q-rows').onchange = plannerChange((o, el) => { o.rows = Number(el.value); o.preset = 'custom'; });
$('#q-setting').onchange = plannerChange((o, el) => { o.setting = el.value; });
$('#q-sashing').onchange = plannerChange((o, el) => { o.sashing = Number(el.value); });
$('#q-inner').onchange = plannerChange((o, el) => { o.innerBorder = Number(el.value); });
$('#q-outer').onchange = plannerChange((o, el) => { o.outerBorder = Number(el.value); if (!o.outerBorder) o.piecedBorder = false; });
$('#q-mirror').onchange = plannerChange((o, el) => { o.mirror = el.checked; });
$('#q-rainbow').onchange = plannerChange((o, el) => { o.rainbow = el.checked; });
$('#q-pieced').onchange = plannerChange((o, el) => { o.piecedBorder = el.checked; });

const hexChange = (mutate) => (e) => {
  const def = DEFS.get(state.blockId);
  if (!def || !isHex(def)) return;
  mutate(hexOptsFor(def), e.target);
  renderHex(def);
};
$('#h-side').onchange = hexChange((o, el) => { o.side = Number(el.value); });
$('#h-layout').onchange = hexChange((o, el) => { o.layout = el.value; });
$('#h-width').onchange = hexChange((o, el) => { o.width = Number(el.value); });
$('#h-height').onchange = hexChange((o, el) => { o.height = Number(el.value); });

$('#buy').onclick = () => { state.cart = state.blockId; location.hash = 'checkout'; };
$('#h-buy').onclick = () => { state.cart = state.blockId; location.hash = 'checkout'; };
$('#preview-pdf').onclick = () => { location.hash = `print/${state.blockId}`; };
$('#h-print').onclick = () => { location.hash = `print/${state.blockId}`; };
$('#r-buy').onclick = () => {
  if (!state.generated) return;
  state.cart = state.generated;
  state.blockId = state.generated;
  location.hash = 'checkout';
};
$('#place-order').onclick = placeOrder;

$('#f-tier').onchange = renderTierControls;
$('#prompt-form').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#prompt-text').value.trim();
  if (v) runGenerate(v);
};

window.addEventListener('hashchange', route);

/* ----------------------------------------------------------------- boot */

renderHome();
renderTierControls();
route();

generatorStatus().then((s) => {
  $('#gen-mode').textContent = s.available ? `live · ${s.model ?? 'Claude'}` : 'stand-in generator';
  $('#gen-mode').title = s.available
    ? 'A server function with an API key is answering.'
    : 'No generator is deployed, so requests are matched against the starter library.';
});

{
  const p = patternFor('teapot');
  $('#engine-line').textContent =
    `pattern-core · ${LIBRARY.length} blocks + ${HEXAGON_LIBRARY.length} hexagon layouts · ${p.math.describe()}`;
}

// Exposed so the engine's test suite can be run against the live page.
window.quiltblock = { makePattern, LIBRARY, HEXAGON_LIBRARY, patternFor, state, toast, stripSvg };
