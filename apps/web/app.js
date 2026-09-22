/**
 * QuiltBlock Studio - the storefront.
 *
 * Every diagram, cut size, sew step and pressing arrow on this page is produced
 * by `packages/pattern-core` at render time. Change the seam allowance in the
 * workbench and the whole pattern is rebuilt, because that is the only honest
 * way to sell a pattern with options on it.
 */

import {
  makePattern,
  LIBRARY,
  SUBJECTS,
  PRICING,
  SEAM_PROFILES,
  TRIM_STYLES,
  fmt,
  unitCounts,
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

const REMEMBERED = ['seam', 'trim', 'blockSize', 'method'];

const state = {
  seam: 'scant-quarter',
  trim: 'classic',
  blockSize: 12,
  copies: 12,
  method: 'patchwork',
  view: 'home',
  blockId: 'cow',
  preview: 'block',
  generated: null,
  cart: null,
  fulfilment: 'download',
  card: DEMO_CARDS[0].id,
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
const DEFS = new Map(LIBRARY.map((d) => [d.id, d]));

function patternFor(id, opts = {}) {
  const def = DEFS.get(id);
  if (!def) return null;
  // Traditional blocks are drafted on coarse grids that only divide certain
  // sizes; fall back to 12" rather than throwing at the customer.
  const wanted = opts.blockSize ?? state.blockSize;
  const tries = [wanted, 12, 16, 8];
  for (const blockSize of tries) {
    try {
      return makePattern(def, { seam: state.seam, trim: state.trim, copies: state.copies, ...opts, blockSize });
    } catch (err) {
      if (blockSize === tries[tries.length - 1]) throw err;
    }
  }
  return null;
}

const priceOf = (p) =>
  p.def.custom ? PRICING.custom : p.block.blockSize <= 10 ? PRICING.block10 : PRICING.block12;

/* ------------------------------------------------------------------- home */

const HOUSE_RULES = [
  ['01', 'Straight lines only', 'Horizontal, vertical, or a true 45° diagonal. Nothing you cannot rotary-cut against a ruler.'],
  ['02', 'The seam is a setting', 'Scant ¼" by default, but ⅛" for a doll quilt or ½" for flannel. Every cut size is derived, never looked up.'],
  ['03', 'Every piece labelled', 'A, B, C in reading order, grouped by fabric, with the cut size next to it and a pressing arrow on the diagram.'],
];

function renderHome() {
  const hero = patternFor('cow');
  $('#hero-block').innerHTML = hero.svg({ scale: 2.4 });
  $('#house-rules').innerHTML = HOUSE_RULES.map(
    ([n, h, b]) => `<div class="rule-card"><span class="n">${n}</span><h3>${h}</h3><p class="muted">${b}</p></div>`,
  ).join('');
  $('#featured').innerHTML = ['mug', 'sawtooth-star', 'ohio-star', 'cowskis']
    .map((id) => cardHtml(patternFor(id)))
    .join('');
}

function cardHtml(p) {
  const counts = unitCounts(p.block);
  const kinds = [
    counts.hst && `${counts.hst} HST`,
    counts.qst && `${counts.qst} hourglass`,
    counts.geese && `${counts.geese} geese`,
  ].filter(Boolean);
  return `<button class="card" data-open="${p.def.id}" aria-label="Open ${esc(p.def.name)}">
    <div class="thumb">${p.svg({ labels: false, scale: 1.3 })}</div>
    <div class="meta">
      <div class="row-between"><span class="name">${esc(p.def.name)}</span><span class="price">$${priceOf(p)}</span></div>
      <span class="sub">${esc(p.def.subject)} &middot; ${p.block.pieces.length} pieces${kinds.length ? ' &middot; ' + kinds.join(', ') : ''}</span>
    </div>
  </button>`;
}

/* --------------------------------------------------------------- catalogue */

let filter = 'All';

function renderCatalog() {
  const subjects = ['All', ...SUBJECTS];
  $('#filters').innerHTML = subjects
    .map((s) => `<button class="chip" data-filter="${esc(s)}" aria-pressed="${s === filter}">${esc(s)}</button>`)
    .join('');
  $('#catalog').innerHTML = LIBRARY.filter((d) => filter === 'All' || d.subject === filter)
    .map((d) => cardHtml(patternFor(d.id)))
    .join('');
}

/* ------------------------------------------------------------------ detail */

function fillSelect(sel, entries, value) {
  sel.innerHTML = entries
    .map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

function renderDetail() {
  const p = patternFor(state.blockId);
  if (!p) return;

  $('#d-subject').textContent = p.def.subject + (p.def.custom ? ' · generated' : '');
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
  $('#f-size').value = String(p.block.blockSize);
  $('#f-copies').value = String(state.copies);
  $('#f-method').value = state.method;

  const seam = SEAM_PROFILES[state.seam];
  $('#seam-note').textContent = `${seam.note} ${p.math.describe()}`;

  // facts
  const counts = unitCounts(p.block);
  $('#d-facts').innerHTML = [
    ['Finished', `${p.block.blockSize}"`],
    ['Pieces', p.block.pieces.length],
    ['Units', p.block.units.length],
    ['Seams', p.plan.seams.length],
    ['Skill', p.difficulty.level],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`)
    .join('');

  // diagram
  if (state.preview === 'quilt') {
    const { cols, rows } = quiltShape(state.copies);
    $('#d-svg').innerHTML = p.quiltSvg({ cols, rows, scale: 0.9 });
  } else if (state.preview === 'press') {
    $('#d-svg').innerHTML = p.svg({ scale: 2.4, overlay: 'pressing', plan: p.plan });
  } else {
    $('#d-svg').innerHTML = p.svg({ scale: 2.4 });
  }
  $('#mode-block').setAttribute('aria-pressed', String(state.preview === 'block'));
  $('#mode-quilt').setAttribute('aria-pressed', String(state.preview === 'quilt'));
  $('#mode-press').setAttribute('aria-pressed', String(state.preview === 'press'));

  $('#d-legend').innerHTML =
    state.preview === 'press'
      ? `<div class="legend">
          <span><i></i> pressed this way, so seams nest</span>
          <span><i class="open"></i> pressed open</span>
          <span><i class="dot"></i> four or more seams meet here</span>
          <span>dashed outline = one sewn unit</span>
        </div>`
      : '';

  $('#d-swatches').innerHTML = p.cutting.fabrics
    .map(
      (f) =>
        `<div class="swatch"><i style="background:${f.hex}"></i><span>${esc(f.name)}</span>` +
        `<span class="muted">&middot; ${f.pieceCount} piece${f.pieceCount === 1 ? '' : 's'} &middot; <span class="num">${esc(f.yardage.label)}</span></span></div>`,
    )
    .join('');

  // Only show constructions the block actually uses, so the row never fills
  // with zeroes and never leaves one tile stranded on a line of its own.
  $('#d-tally').innerHTML = [
    ['Patches', counts.patch],
    ['Half-square', counts.hst],
    ['Hourglass', counts.qst],
    ['Flying geese', counts.geese],
    ['Pressed open', p.plan.pressOpenCount],
  ]
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v num">${v}</span></div>`)
    .join('');

  $('#d-price').textContent = `$${priceOf(p)}`;

  renderSeamPanel(p);
  renderCuts(p);
  renderOrder(p);
}

function quiltShape(n) {
  const table = { 1: [1, 1], 4: [2, 2], 12: [4, 3], 30: [6, 5] };
  return { cols: (table[n] ?? [4, 3])[0], rows: (table[n] ?? [4, 3])[1] };
}

function renderSeamPanel(p) {
  const counts = unitCounts(p.block);
  const constructions = [
    counts.patch && ['Plain patches', `${counts.patch} rectangles, cut at the finished size plus ${fmt(p.math.allowance * 2)}.`],
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

  const rowsHtml = p.cutting.fabrics
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
            <td class="muted num" style="font-size:.85em">${esc(e.labels.join(', '))}</td>
          </tr>`,
        )
        .join(''),
    )
    .join('');

  $('#d-cuts').innerHTML = `
    <div class="tablewrap">
      <table class="spec">
        <caption>Cutting list &mdash; ${state.copies} block${state.copies === 1 ? '' : 's'}, ${esc(p.math.seam.name)} seam</caption>
        <thead><tr><th>Fabric</th><th class="qty">Cut</th><th>Size</th><th>For</th><th>Pieces</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="muted" style="font-size:.84rem;margin-top:8px">Yardage is an estimate with cutting
      waste included, based on 42" usable width.</p>`;
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

/* ------------------------------------------------------------ custom flow */

let generating = false;

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
    const result = await generate({
      prompt,
      photo,
      fabricLimit: Number($('#f-fabrics').value),
      gridSize: Number($('#f-grid').value),
      blockSize: state.blockSize,
    });

    const def = { ...result.block, custom: true };
    DEFS.set(def.id, def);
    const p = makePattern(def, { seam: state.seam, trim: state.trim, copies: 1 });
    state.generated = def.id;

    clearInterval(tick);
    steps.forEach((li) => { li.classList.remove('on'); li.classList.add('done'); });

    $('#stage-empty').hidden = true;
    $('#result').hidden = false;
    $('#r-svg').innerHTML = p.svg({ scale: 2.4 });
    $('#r-name').textContent = def.name;
    const counts = unitCounts(p.block);
    $('#r-facts').textContent =
      `${p.block.blockSize}" block · ${p.block.pieces.length} pieces · ` +
      `${p.block.fabricsUsed.length} fabrics · ${p.difficulty.level}. ` +
      `${counts.patch} patches, ${counts.hst} half-square triangles, ${counts.qst} hourglass, ${counts.geese} flying geese.`;
    $('#r-swatches').innerHTML = p.cutting.fabrics
      .map((f) => `<div class="swatch"><i style="background:${f.hex}"></i><span>${esc(f.name)}</span></div>`)
      .join('');
    $('#r-checks').innerHTML = checksHtml(p, result);
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

function checksHtml(p, result) {
  const v = p.validation;
  const lines = [
    ['Straight lines only', !v.errors.some((e) => e.rule === 'straight-lines')],
    ['Pieces fill the block exactly', !v.errors.some((e) => e.rule === 'covers-block')],
    ['Nothing too small to sew', !v.errors.some((e) => e.rule === 'min-size')],
    ['Piece count in range', !v.errors.some((e) => e.rule === 'pieces')],
    ['Every piece labelled', !v.errors.some((e) => e.rule === 'labels')],
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

function renderCheckout() {
  const p = patternFor(state.cart ?? state.blockId);
  if (!p) return;

  $('#order-summary').innerHTML = `
    <h3 style="font-size:1rem">${esc(p.def.name)}</h3>
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

  renderLines(p);
  renderFulfilmentDetail();
}

function renderLines(p) {
  const f = FULFILMENT.find((x) => x.id === state.fulfilment) ?? FULFILMENT[0];
  const subtotal = priceOf(p);
  const tax = Math.round((subtotal + f.price) * 0.07 * 100) / 100;
  $('#lines').innerHTML = `
    <div><span>Pattern PDF &mdash; ${p.block.blockSize}" block, ${esc(p.math.seam.name)} seam</span><span class="num">${money(subtotal)}</span></div>
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
  const p = patternFor(state.cart ?? state.blockId);
  const btn = $('#place-order');
  btn.disabled = true;
  btn.textContent = 'Pretending to charge the card…';
  const order = await checkout({
    items: [{ name: p.def.name, price: priceOf(p) }],
    fulfilment: FULFILMENT.find((f) => f.id === state.fulfilment),
    method: state.card,
  });
  btn.disabled = false;
  btn.textContent = 'Place the (pretend) order';
  $('#order-result').innerHTML = `<div class="callout" style="margin-top:16px">
    <strong>Order ${esc(order.orderId)} — not a real order.</strong>
    <span>${money(order.total)} would have gone to ${esc(order.method.brand)} •••• ${esc(order.method.last4)}.
    No money moved and no card was charged, because no card exists.</span>
    <span style="margin-top:6px"><a href="#print/${esc(p.def.id)}">Open the printable pattern &rarr;</a></span>
  </div>`;
}

/* ----------------------------------------------------------- print view */

function renderPrint() {
  const p = patternFor(state.blockId);
  if (!p) return;
  const f = state.method === 'fpp' ? p.foundation() : null;

  const cuts = p.cutting.fabrics
    .map((fab) =>
      fab.entries
        .map(
          (e, i) =>
            `<tr><td>${i === 0 ? esc(fab.name) : ''}</td><td class="qty">${e.qty}</td>
             <td class="num">${esc(e.cut)}</td><td>${esc(e.purpose)}</td><td class="num">${esc(e.labels.join(', '))}</td></tr>`,
        )
        .join(''),
    )
    .join('');

  $('#print-body').innerHTML = `
    <div class="row-between" style="align-items:flex-start">
      <div>
        <div class="eyebrow">QuiltBlock Studio</div>
        <h1 style="font-size:2rem;margin:4px 0">${esc(p.def.name)}</h1>
        <p class="num">${p.block.blockSize}" finished block &middot; ${p.block.pieces.length} pieces &middot;
          ${esc(p.math.seam.name)} seam &middot; ${esc(p.difficulty.level)}</p>
      </div>
      <div class="test-square">1 inch<br>check me</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px">
      <div>${p.svg({ scale: 1.7 })}</div>
      <div>${p.svg({ scale: 1.7, labels: false, overlay: 'pressing', plan: p.plan })}
        <p style="font-size:.8rem">Pressing plan. Arrows show which way each seam goes;
        circles mark where four or more pieces meet.</p></div>
    </div>

    <h2 style="margin-top:26px;font-size:1.3rem">Fabrics</h2>
    <ul style="font-size:.9rem">${p.cutting.fabrics
      .map((fab) => `<li>${esc(fab.name)} &mdash; ${fab.pieceCount} pieces &mdash; about ${esc(fab.yardage.label)}</li>`)
      .join('')}</ul>

    <h2 style="margin-top:22px;font-size:1.3rem">Cutting list</h2>
    <table class="spec"><thead><tr><th>Fabric</th><th class="qty">Cut</th><th>Size</th><th>For</th><th>Pieces</th></tr></thead>
      <tbody>${cuts}</tbody></table>

    <div class="page-break"></div>
    <h2 style="margin-top:22px;font-size:1.3rem">Sew it in this order</h2>
    <ol style="font-size:.9rem">${(f ? f.instructions.map((t) => ({ text: t })) : p.plan.steps)
      .map((s) => `<li>${esc(s.text)}</li>`)
      .join('')}</ol>

    <p style="font-size:.78rem;margin-top:24px">Print at 100% &mdash; no "fit to page". Measure the
      1" square above with a ruler before cutting anything. ${esc(p.math.describe())}</p>`;
}

/* -------------------------------------------------------------- routing */

const VIEWS = ['home', 'patterns', 'detail', 'custom', 'checkout', 'print'];

function route() {
  const hash = location.hash.replace(/^#/, '') || 'home';
  const [head, arg] = hash.split('/');
  let view = head === 'pattern' ? 'detail' : head;
  if (!VIEWS.includes(view)) view = 'home';
  if ((head === 'pattern' || head === 'print') && arg && DEFS.has(arg)) state.blockId = arg;
  if (head === 'print') view = 'print';

  state.view = view;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $$('nav a').forEach((a) => {
    const on = a.dataset.nav === view || (view === 'detail' && a.dataset.nav === 'patterns');
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (view === 'patterns') renderCatalog();
  if (view === 'detail') renderDetail();
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

  const f = e.target.closest('[data-filter]');
  if (f) { filter = f.dataset.filter; renderCatalog(); return; }

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
$('#checkout-back').onclick = () => history.back();
$('#print-back').onclick = () => { location.hash = `pattern/${state.blockId}`; };
$('#do-print').onclick = () => window.print();

$('#mode-block').onclick = () => { state.preview = 'block'; renderDetail(); };
$('#mode-quilt').onclick = () => { state.preview = 'quilt'; renderDetail(); };
$('#mode-press').onclick = () => { state.preview = 'press'; renderDetail(); };

$('#f-seam').onchange = (e) => { state.seam = e.target.value; remember(); renderDetail(); };
$('#f-trim').onchange = (e) => { state.trim = e.target.value; remember(); renderDetail(); };
$('#f-size').onchange = (e) => { state.blockSize = Number(e.target.value); remember(); renderDetail(); };
$('#f-copies').onchange = (e) => { state.copies = Number(e.target.value); renderDetail(); };
$('#f-method').onchange = (e) => { state.method = e.target.value; remember(); renderDetail(); };

$('#buy').onclick = () => { state.cart = state.blockId; location.hash = 'checkout'; };
$('#preview-pdf').onclick = () => { location.hash = `print/${state.blockId}`; };
$('#r-buy').onclick = () => {
  if (!state.generated) return;
  state.cart = state.generated;
  state.blockId = state.generated;
  location.hash = 'checkout';
};
$('#place-order').onclick = placeOrder;

$('#prompt-form').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#prompt-text').value.trim();
  if (v) runGenerate(v);
};

window.addEventListener('hashchange', route);

/* ----------------------------------------------------------------- boot */

renderHome();
route();

generatorStatus().then((s) => {
  $('#gen-mode').textContent = s.available ? `live · ${s.model ?? 'Claude'}` : 'stand-in generator';
  $('#gen-mode').title = s.available
    ? 'A server function with an API key is answering.'
    : 'No generator is deployed, so requests are matched against the starter library.';
});

{
  const p = patternFor('cow');
  $('#engine-line').textContent =
    `pattern-core · ${LIBRARY.length} blocks · ${p.math.describe()}`;
}

// Exposed so the engine's test suite can be run against the live page.
window.quiltblock = { makePattern, LIBRARY, patternFor, state };
