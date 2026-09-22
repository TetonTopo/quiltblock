/**
 * POST /.netlify/functions/checkout   -- SCAFFOLD, NOT WIRED UP.
 *
 * This file deliberately does not take money. It exists so that the shape of a
 * real checkout is in the repo, in one place, with the decisions written down -
 * because the way a small shop usually gets payments wrong is by doing them in
 * the browser, and by the time that is obvious it is load-bearing.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * Card details never touch this codebase. Not the browser, not this function,
 * not the logs. The customer types their card into an iframe served by the
 * payment processor, on the processor's own domain. What comes back to us is an
 * opaque token. That is what keeps a hobby shop out of PCI compliance scope,
 * and it is not optional.
 *
 * WHAT A REAL IMPLEMENTATION DOES
 *   1. The browser asks this endpoint for a checkout session, sending only
 *      pattern ids and options - never a price. Prices are looked up here, from
 *      the catalogue, because a price sent by the browser is a price the
 *      customer chose.
 *   2. This function creates the session with the processor's SDK using a
 *      secret key from the environment, and returns the session URL.
 *   3. The customer pays on the processor's page.
 *   4. The processor calls a SEPARATE webhook function. That webhook - not the
 *      browser's redirect - is what marks the order paid, because the browser
 *      can be closed, replayed, or lied to. The webhook must verify the
 *      signature header before trusting a single byte of the payload.
 *   5. Only then is a download link issued: signed, time-limited, and tied to
 *      the order, so the URL cannot be passed around.
 *
 * WHAT IS STILL UNDECIDED (see docs/commerce.md)
 *   - Whose business entity and bank account the shop runs on.
 *   - Sales tax. Digital goods are taxed differently state by state, and most
 *     processors will handle it if you let them.
 *   - Refunds on a download-only product, which is mostly a policy question.
 */

const json = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  return json(501, {
    error: 'Checkout is not implemented.',
    mock: true,
    detail:
      'The storefront mocks payment in the browser and says so on screen. ' +
      'This endpoint is a placeholder for a server-side checkout session.',
    nextSteps: [
      'Choose a payment processor and open an account under the shop’s business entity.',
      'Put its secret key in the host environment as STRIPE_SECRET_KEY (or equivalent). Never in the repo.',
      'Create the session here from catalogue prices, never from prices sent by the browser.',
      'Add a webhook function that verifies the signature and marks the order paid.',
      'Issue signed, expiring download links only after the webhook confirms payment.',
    ],
  });
}

/**
 * The catalogue prices, kept server-side on purpose. The browser shows these
 * too, but this copy is the one that would be charged.
 */
export const PRICE_LIST = {
  'block-10': { cents: 1000, label: '10" block pattern' },
  'block-12': { cents: 1500, label: '12" block pattern' },
  'full-quilt': { cents: 2200, label: 'Full quilt pattern' },
  custom: { cents: 3500, label: 'Custom generated block' },
  'print-and-post': { cents: 1200, label: 'Printed and posted' },
};
