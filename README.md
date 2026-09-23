# QuiltBlock

Quilt patterns generated from geometry.

You pick a block — or describe one nobody has made, at the skill level you want
— and get back a whole quilt pattern that actually sews: every piece labelled with its exact cut size, the seam
allowance applied correctly for the construction it belongs to, a sew order
that never asks for a partial seam it did not warn you about, and a pressing
plan that says which way each seam goes and why, and the quilt planned around it:
sashing, borders, yardage as width-of-fabric strips, binding and backing.

There is no image generation anywhere in this project. A quilt pattern is not a
picture of a quilt; it is a list of shapes and the order you sew them in. The
engine works in integer sixteenths of an inch from end to end, so a cut size is
never a rounded float.

---

## The rules the engine enforces

These came from a quilter rather than a spec, and `packages/pattern-core/src/validate.js`
is where they live in code. Nothing reaches a customer without passing them.

- **Straight lines only.** Horizontal, vertical, or a true 45° diagonal. Nothing
  you cannot rotary-cut against a ruler.
- **The pieces must tile the block exactly.** Checked by area, every time.
- **Every piece labelled**, in reading order, grouped by fabric, with its cut size.
- **Flat and crayon-simple.** A silhouette, not a rendering.
- **Difficulty is piece count, not colour count** — and triangles count for more
  than squares, because bias edges stretch and straight grain does not.
- **Nothing too small to sew.**
- **Complexity is a dial.** Beginner, confident beginner, intermediate and
  advanced are computed from the geometry — pieces, bias edges, tiny bits — never
  typed in. The generator takes the level as an instruction and rejects drafts
  that land outside it.

## Seams

Seams are the part most pattern software gets wrong by treating "add ½ inch" as
a constant. Three separate things vary, and all three are settings here.

**Seam allowance.** Scant ¼″, true ¼″, ⅛″ for miniatures, ⅜″ for loose weaves,
½″ for heirloom work. Every cut size is *derived* from the allowance rather than
looked up, including the bias math — a triangle's allowance runs along a 45°
edge, so it needs √2 times the allowance at each corner. At ¼″ that derivation
produces the ⅞″ every quilter has memorised for a half-square triangle and the
1¼″ for a quarter-square. At ⅛″ it produces the right numbers for ⅛″, instead of
the ¼″ numbers with a wrong label on them.

**Piecing construction.** Each unit is built the way that unit is actually
built, and the cutting list is costed accordingly:

| Construction | What you cut | What it yields |
|---|---|---|
| Plain patch | finished size + 2 × allowance | 1 |
| Stitch-and-flip corner | one small square per corner, finished leg + 2 × allowance | the corner |
| Half-square triangle | one square per fabric, finished leg + ⅞″ | 2 units per pair |
| Hourglass (quarter-square) | one square per fabric, finished + 1¼″ | 2 units per pair |
| No-waste flying geese | 1 large square + 4 small | 4 units per set |
| Foundation paper piecing | rough-cut rectangles, trimmed as you sew | — |

Nobody cuts fourteen triangles. They cut seven squares of each fabric and get
fourteen units, and the list says so — with the spares called out. And nobody
cuts a triangle for a teapot's corner either: a one-cell triangle at the corner
of a run of plain cells is absorbed into the rectangle as a stitch-and-flip
corner, the way every commercial pattern does it. It is a switch on the
workbench; half-square triangles waste less fabric, corners are easier.

The whole list is then planned as strips: "(6) strips 3½″ × WOF; subcut (32)
rectangles 3½″ × 6½″", and yardage is the running length of strips rounded up
to the next eighth. See [docs/quilts.md](docs/quilts.md).

**Pressing.** Every seam gets a direction and a reason. The default is nesting:
adjacent seams are pushed in opposite directions so they lock together at the
intersection, which is the entire reason quilters care. Where four or more
pieces meet, the seam that *runs across* that junction is pressed open instead —
but a seam merely *ending* at one is left to nest, because those are exactly the
seams that should.

**Partial seams, and not needing them.** A block can only be sewn by joining two
flat halves if some line crosses it edge to edge without passing through a unit.
The engine finds that decomposition — it is where the sew order comes from — and
if a region has no such line, the block needs a partial seam, which is the one
genuinely hard technique in flat patchwork.

Most of those dead ends turn out to be self-inflicted. Greedily merging
same-fabric cells into the largest rectangles will hook two patches around each
other like an L, and there is then no straight seam anywhere. Splitting one of
them costs one extra piece and one extra straight seam, and removes the partial
seam entirely. The engine does that automatically and reports how many splits it
took. Every block in the starter library sews in straight seams; the sailboat
needed one split to get there.

---

## Running it

The app is plain ES modules with no build step, but ES modules will not load
over `file://`, so it needs a static server rather than a double-click.

```bash
npx serve . --listen 8099
```

On Windows with nothing installed, there is a dependency-free server that uses
the HTTP listener built into the OS:

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Then open <http://localhost:8099>.

### Tests

```bash
node packages/pattern-core/test/run.js
```

The suite is plain ES modules with a small assert shim and no framework, so the
same file also runs in a browser — serve the repo and run this in the console:

```js
(await import('/packages/pattern-core/test/core.test.js')).report()
```

---

## The generator

`netlify/functions/generate.js` turns a description or a photo into a block. It
is the only place in the project that holds an API key, and it runs on the
server: the browser never sees the key and cannot reach the model except through
this endpoint.

The model does not get the last word. Whatever it returns is built with
`pattern-core` and run through the house rules. If it fails, the failure is
handed back in words and it tries once more. If it fails twice the customer gets
an error rather than a pattern that does not sew.

```bash
npm install
cp .env.example .env     # then put a key in it
```

Set `ANTHROPIC_API_KEY` in your host's environment settings — never in the repo;
`.env` is gitignored. With no key configured the storefront falls back to a
local stand-in that matches the request against the starter library, and it
labels itself "stand-in generator" on screen rather than pretending.

See [docs/deploying.md](docs/deploying.md).

---

## What is real and what is mocked

Being precise about this matters, because a demo that blurs the line is how
someone ends up believing a payment went through.

**Real.** All of the geometry. Seam allowance math, cutting lists, yardage
estimates, sew order, pressing plans, partial-seam detection, foundation paper
piecing templates, the printable pattern, and the generator when a key is
configured.

**Mocked.** Payment and fulfilment, both clearly marked in the UI.

Payment is mocked in a specific way: **there is deliberately no field anywhere in
this app to type a card number into.** The saved cards on the checkout screen are
fictional and no card data is collected, stored or transmitted. That is not just
for the demo — it is how the real thing should work too. Card details belong in
an iframe served by the payment processor on the processor's own domain, and
what comes back to the shop is an opaque token. `netlify/functions/checkout.js`
is a scaffold that writes that decision down and does not take money.

Print-and-post and the print-shop finder are invented, and say so on screen.

---

## Layout

```
index.html                        the storefront shell
apps/web/                         styles, app, and the API client
packages/pattern-core/
  src/units.js                    sixteenths, fractions, colour lightness
  src/seams.js                    allowances, trim margins, derived cut math
  src/block.js                    the grid DSL, merging, unit geometry
  src/partition.js                guillotine decomposition and merge repair
  src/assembly.js                 sew order, seam types, pressing plan
  src/cutting.js                  cutting list, yields, yardage
  src/validate.js                 the house rules
  src/fpp.js                      foundation paper piecing
  src/render.js                   SVG
  src/blocks.js                   the starter library
  test/                           the suite
netlify/functions/generate.js     the generator (holds the API key)
netlify/functions/checkout.js     payment scaffold, deliberately not wired up
tools/serve.ps1                   zero-dependency static server for Windows
docs/                             the grid DSL, quilts, deploying, commerce
```

## The grid DSL

A block is an array of rows; each row is whitespace-separated cell tokens, and
fabrics are single letters.

```
k      a plain patch of fabric k
a/b    half-square triangle, diagonal like "/"
a\b    half-square triangle, diagonal like "\"
a+b    hourglass: a top and bottom, b left and right
a^b    flying goose pointing up, two cells wide
avb    down      a>b  right      a<b  left
.      continuation of the multi-cell unit to the left or above;
       after a/b or a+b, "." cells make it an n×n unit

A one-cell triangle at the corner of a rectangle of its inner fabric becomes a
stitch-and-flip corner: "k/p p p kp" is a strip of p with both top corners
clipped. `subgrid: 2` keeps four quarter-blocks from merging into each other.
Hexagon patterns are their own thing — see docs/quilts.md.
```

An Ohio star, whole:

```js
{
  fabrics: { k: { name: 'Oatmeal linen', hex: '#E7DDCB' },
             c: { name: 'Madder red',    hex: '#B8453A' } },
  rows: ['k   c+k k',
         'k+c c   k+c',
         'k   c+k k'],
}
```

Adjacent plain cells of the same fabric merge into the largest rectangles they
form, so a big flat background costs one piece rather than forty. Full reference
in [docs/grid-dsl.md](docs/grid-dsl.md).

---

## Licence

MIT — see [LICENSE](LICENSE). Replace the copyright holder with the shop's
business name once it is chosen.
