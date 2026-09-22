/**
 * The browser's view of the back end.
 *
 * Three surfaces, at three very different stages of real:
 *
 *   generate()  calls a server function that holds the Anthropic API key. The
 *               key never reaches this file. If no function is deployed, this
 *               falls back to a local stand-in so the demo still works.
 *   checkout()  MOCKED. No card data is collected anywhere in this app.
 *   fulfilment() MOCKED. Print partners and shipping are invented.
 *
 * Everything mocked returns `mock: true`, and the UI is required to show that.
 */

const API_BASE = '/.netlify/functions';

let generatorProbe = null;

/** Is a real generator deployed behind this page? Probed once, cached. */
export function generatorStatus() {
  if (!generatorProbe) {
    generatorProbe = fetch(`${API_BASE}/generate`, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => ({ available: Boolean(d.available), model: d.model }))
      .catch(() => ({ available: false }));
  }
  return generatorProbe;
}

/**
 * Ask the server to design a block. Returns a block definition in the grid DSL
 * that `pattern-core` can build, plus whatever the model said about it.
 */
export async function generate({ prompt, photo, fabricLimit, gridSize, blockSize }) {
  const status = await generatorStatus();
  if (!status.available) {
    return { ...(await mockGenerate({ prompt, fabricLimit, gridSize })), mock: true };
  }

  const body = { prompt, fabricLimit, gridSize, blockSize };
  if (photo) body.photo = photo; // { media_type, data } base64, no data: prefix

  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new GenerateError(detail.error || `The generator returned ${res.status}.`, detail);
  }
  return { ...(await res.json()), mock: false };
}

export class GenerateError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'GenerateError';
    this.detail = detail;
  }
}

/**
 * The local stand-in. It matches the request against the starter library, which
 * is honest about what it is: a lookup, not a designer. It exists so the demo
 * works with no key, no network and no account.
 */
async function mockGenerate({ prompt, fabricLimit, gridSize }) {
  const { LIBRARY } = await import('../../packages/pattern-core/src/blocks.js');
  const p = String(prompt || '').toLowerCase();
  const match =
    (/ski/.test(p) && 'cowskis') ||
    (/mug|coffee|cup|tea/.test(p) && 'mug') ||
    (/cat|kitten/.test(p) && 'cat') ||
    (/boat|sail|ship/.test(p) && 'sailboat') ||
    (/mountain|peak|alp/.test(p) && 'mountain') ||
    (/tree|pine|forest|spruce/.test(p) && 'pine') ||
    (/barn|house|shed/.test(p) && 'barn') ||
    (/star/.test(p) && 'sawtooth-star') ||
    'cow';

  await new Promise((r) => setTimeout(r, 260));
  const def = LIBRARY.find((b) => b.id === match);
  return {
    block: { ...def, id: `custom-${match}`, custom: true, subject: 'Custom' },
    notes: `Matched “${prompt}” to the closest block in the starter library.`,
    fabricLimit,
    gridSize,
  };
}

/* -------------------------------------------------------------------------
   Payment - mocked, and deliberately incapable of taking a real card.
   ------------------------------------------------------------------------- */

/** Fictional saved cards. There is no field anywhere to type a real one into. */
export const DEMO_CARDS = [
  { id: 'demo-visa', brand: 'Visa', last4: '4242', label: 'Demo card' },
  { id: 'demo-mc', brand: 'Mastercard', last4: '4444', label: 'Demo card' },
];

export async function checkout({ items, fulfilment, method }) {
  await new Promise((r) => setTimeout(r, 420));
  const subtotal = items.reduce((s, i) => s + i.price, 0);
  const shipping = fulfilment?.price ?? 0;
  const tax = Math.round((subtotal + shipping) * 0.07 * 100) / 100;
  return {
    mock: true,
    orderId: `QB-DEMO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    subtotal,
    shipping,
    tax,
    total: Math.round((subtotal + shipping + tax) * 100) / 100,
    method: DEMO_CARDS.find((c) => c.id === method) ?? DEMO_CARDS[0],
    fulfilment,
    placedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------
   Fulfilment - mocked. Real print partners would be an API integration.
   ------------------------------------------------------------------------- */

export const FULFILMENT = [
  {
    id: 'download',
    name: 'Download the PDF',
    price: 0,
    eta: 'Right now',
    real: true,
    blurb:
      'Tiled onto letter or tabloid with registration marks and a 1" test square. ' +
      'Print it at home, or take the file to a copy shop.',
  },
  {
    id: 'mail-print',
    name: 'Printed and posted to you',
    price: 12,
    eta: '5–7 days',
    real: false,
    blurb:
      'Full-size on a single sheet of 24" plotter paper, rolled in a tube. No taping ' +
      'pages together. Would be handled by a print partner.',
  },
  {
    id: 'find-printer',
    name: 'Find somewhere near you to print it',
    price: 0,
    eta: 'Same day, usually',
    real: false,
    blurb:
      'We hand you the file and a list of shops that can do large format, with what ' +
      'to ask for.',
  },
];

/** Invented shops, so the flow can be walked through end to end. */
export async function findPrinters(postcode) {
  await new Promise((r) => setTimeout(r, 320));
  return {
    mock: true,
    postcode: postcode || '—',
    shops: [
      { name: 'Copy & Print on Main', distance: '0.8 mi', note: 'Large format, same day' },
      { name: 'The Print Room', distance: '2.1 mi', note: '24" plotter, next day' },
      { name: 'Campus Reprographics', distance: '3.4 mi', note: 'Cheapest per sheet' },
    ],
    askFor:
      'Ask for 100% scale, no fit-to-page, on 24" bond. Then measure the 1" test ' +
      'square before you cut anything.',
  };
}
