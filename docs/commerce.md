# Taking money, and sending people a file

Everything in this document is **not built**. The storefront mocks payment and
fulfilment and says so on screen. This is the plan, written down while the
decisions are still cheap to change.

## Payment

### The one rule

Card details never touch this codebase — not the browser, not the functions,
not the logs.

The customer types their card into an iframe served by the payment processor on
the processor's own domain. What comes back is an opaque token. This is what
keeps a small shop out of PCI compliance scope, and it is not a shortcut: a
hand-rolled card field is a liability the moment it exists.

That is why the mocked checkout in this app has **no card field at all**. The
saved cards are fictional. A demo with a realistic-looking card input trains
people to type real card numbers into things, and eventually someone does.

### The shape of the real thing

1. The browser asks `POST /checkout` for a session, sending pattern ids and
   options — **never a price**. A price that comes from the browser is a price
   the customer chose. `netlify/functions/checkout.js` keeps the price list
   server-side for exactly this reason.
2. The function creates the session with the processor's SDK, using a secret key
   from the host environment, and returns the session URL.
3. The customer pays on the processor's page.
4. The processor calls a **separate webhook function**, which verifies the
   signature header before trusting anything in the payload, and only then marks
   the order paid. The browser's redirect back to the site is not proof of
   payment — it can be closed, replayed, or forged.
5. The webhook issues the download: a signed, time-limited URL tied to the
   order, so the link cannot be forwarded indefinitely.

### Still to decide

- **Whose entity and bank account.** Everything else follows from this, and it
  determines who is liable for chargebacks and who files the tax.
- **Sales tax on digital goods.** Taxed differently state by state and country
  by country. Most processors will calculate and remit it if configured; doing
  it by hand is not worth it at this scale.
- **Refunds.** A download cannot be returned, so this is a policy question, not
  a technical one. Most pattern shops refund on request and eat the rare abuse,
  because the alternative costs more in support than in refunds.
- **Accounts, or not.** Order history and re-downloads are the main reason to
  have them, and a magic-link email is usually enough — no passwords to store.

## Getting the pattern to the customer

Three routes, in increasing order of how much can go wrong.

### 1. Download the PDF — built

The printable pattern is generated in the browser from the same engine and
prints at 100% with a 1″ test square on the first page. This works today.

What is still missing for large blocks: tiling across multiple sheets with
registration marks and page numbers, so a 16″ block can be assembled from four
letter-size pages. The print view currently assumes the block fits one page.

**The 1″ test square is not decoration.** Printer drivers scale by default, and
a pattern printed at 97% produces a quilt that does not go together. It is the
first thing on the page and the instructions say to measure it before cutting.

### 2. Printed and posted — mocked

Full size on a single sheet of plotter paper, rolled in a tube, no taping. This
is the nicest experience and the one that introduces a supply chain: a print
partner's API, a shipping address, tax by destination, a tracking number, and
something to do when a tube arrives crushed.

Worth doing, worth doing last.

### 3. Find somewhere to print it — mocked

Hand over the file and a list of nearby shops that do large format, with the
exact words to say: 100% scale, no fit-to-page, 24″ bond. This costs almost
nothing to build and removes the main reason someone bounces off a large
pattern.

The mocked version invents shops. A real one needs a places API and needs to be
honest that the shops are search results rather than partners.

## Roughly in order

1. Multi-page tiling with registration marks — the download route is the one
   people will actually use, and it is incomplete for big blocks.
2. Real checkout with a processor, webhook verification, and signed download
   links.
3. Order history behind magic-link email.
4. The print-shop finder.
5. Print and post.
