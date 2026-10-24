# QuiltBlock - project map

A pattern shop for Dakotah's mom: quilt patterns built from geometry (exact
cut sizes, sew order, pressing, the whole quilt planned), plus a Claude-powered
generator that turns a description or a photo into a new block. "QuiltBlock"
is still a placeholder name. Last updated 2026-10-24.

## Where everything lives

| What | Where |
|---|---|
| Live site | https://quiltblock.netlify.app (deploys from `main` on every push) |
| Code | https://github.com/TetonTopo/quiltblock (public). Working clone on the render box: `C:\Users\dk\Documents\quiltblock`. The older `C:\Users\dk\cowork\quiltblock` predates a force-push: ignore it. |
| Hosting | Netlify project `quiltblock` (site id `997e4060-cfc8-4948-bd5f-db123bbf32e5`), **free plan**: functions stop at 30 s, no background functions |
| Model + billing | Anthropic Console, workspace **QuiltBlock** (key + monthly spend limit live there) |
| Project hub | Notion "QuiltBlock - AI Quilt Pattern Studio" (Tasks + Thread Log databases). Every thread reads it first and appends to the Thread Log last. |
| Mom's patterns | Drive folder `1v69XU6GHRHV-fHhQwmrmaCGPVESYPasa` (Patterns_Part1-11.pdf, link-shared, so curl works). The first 7 scans are on the Gmail thread "Fwd: Lisa's Designs". Catalogue: [pattern-pile.md](pattern-pile.md). |

## The code

```
index.html                     storefront shell (all views; hash routing)
apps/web/
  app.js                       the storefront: catalog, pattern page, planner, custom generator, print view
  api.js                       browser -> server: generate() (tester code, page-side retry), mocked checkout
  styles.css
packages/pattern-core/src/     the engine - pure ES modules, runs in Node and the browser
  units.js  seams.js           sixteenths of an inch; cut sizes DERIVED from the seam allowance
  block.js                     grid DSL -> units -> pieces; stitch-and-flip merge; rectangles; mirrorDef
  partition.js assembly.js     guillotine decomposition, sew order, pressing plan
  cutting.js                   cutting list as width-of-fabric strips, yardage
  validate.js  tiers.js        house rules; difficulty score -> Beginner..Advanced (computed, never typed)
  quilt.js                     planner: settings (straight, sashed, cornerstones, alternate, panel),
                               any number of borders, alternateWith, corner blocks, rainbow, pieced border
  render.js tiles.js fpp.js    SVGs; full-size pages with registration marks; foundation piecing
  colorways.js hexagons.js     colorways; English paper piecing (deliberately outside the block engine)
  blocks.js  pile.js           library: 30 starter blocks + 36 drafted from Mom's pile (66) + 3 hexagon layouts
netlify/functions/generate.js  THE GENERATOR: the only code holding the API key
netlify/lib/draft.js           checkDraft: the gate a model draft must pass
netlify/lib/limits.js          rate limits (Netlify Blobs, append-only), tester code, kill switch
netlify/functions/checkout.js  payment scaffold, deliberately NOT wired (no card field anywhere)
netlify/test/generator.test.js generator + limits tests (stubbed model, no API calls)
tools/try-generate.mjs         run the real generator locally (key in .env) or against the site (--live)
tools/serve.ps1                static server for Windows with nothing installed
docs/                          grid-dsl, quilts, pattern-pile, deploying, commerce, this map
```

## How a generated block happens

```
page (Make your own) --POST {prompt, photo<=1568px, tier, code}--> generate.js
  1. kill switch / tester code (QUILTBLOCK_ACCESS_CODE)
  2. limits.admit(): per-IP hourly + site daily cap in Blobs store "generator-limits"
  3. Claude (claude-opus-5-5, effort low, adaptive thinking, strict draft_block tool,
     tool_choice auto, server-side refusal fallback), one call, 26 s budget
  4. checkDraft(): build with pattern-core, house rules, tier limits
  5. 200 block | 422 rejected {retryable, problem} | 504 too slow {retryable}
page: on retryable, asks ONCE more with previousProblem, then shows the block
```

## Environment variables (Netlify; values never in the repo)

`ANTHROPIC_API_KEY` (set Oct 21; not secret-masked - the Netlify MCP cannot store secrets on this plan),
`QUILTBLOCK_ACCESS_CODE` (tester code - read it in Netlify), `QUILTBLOCK_DAILY_CAP` 40,
`QUILTBLOCK_PER_IP_HOURLY` 10, `QUILTBLOCK_HASH_SALT`. Optional: `QUILTBLOCK_EFFORT` (low),
`QUILTBLOCK_TIME_LIMIT_S` (30; set 60 on a paid plan), `QUILTBLOCK_MODEL`, `QUILTBLOCK_GENERATOR=off`.
Full table: [deploying.md](deploying.md).

## Working on it

```bash
"/c/Program Files/nodejs/node.exe" packages/pattern-core/test/run.js     # 88 tests, all must pass
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8099      # local site, http://localhost:8099
node tools/try-generate.mjs "a cow" --live --code <tester code>          # real generator via the site
```

- Node is installed but not on PATH; npm is in the same folder. No Python needed.
- Deploy = push to `main`. A Netlify env change needs a new deploy: push an empty commit.
- Check pages with headless Chrome (`--screenshot`, `--dump-dom`, `--print-to-pdf`); DK works remotely,
  so show him private artifacts or the live URL, not localhost.
- DK's rule: commit to a branch and ask before pushing/merging to main (he approved pushes on Oct 20-21).

## Decisions to keep

- No card field anywhere; payment and fulfilment stay mocked until a processor is chosen.
- Cut sizes are derived from the seam allowance, never looked up. Tiers are computed, never typed.
- Straight lines only in the block engine; hand piecing lives in hexagons.js.
- ¾" finished is the floor; Advanced patterns may bend it to ½", flagged and rated Advanced. Nothing under ½".
- Piece ceiling 100 (the medallion stars are 79-88). Generator tiers cap much lower.
- No pattern text from Mom's commercial patterns in the repo - geometry only, renamed, `source` kept for us.

## Where it stands (Oct 24)

- Live generator works: a hen from text in 15.5 s / $0.025 (valid but reads poorly), a star from a
  cover photo in 19.9 s / $0.05 (good). High effort draws better (41 s / $0.07) but cannot run in 30 s.
- 88 tests. Library 66 blocks + 3 hexagon layouts. Full-size tiled printing. Mom has reviewed nothing yet.

## Open decisions and next work, in order

1. **DK: Netlify plan.** Stay free (30 s, low effort), go paid (60 s + background functions -> high
   effort, better pictures; set `QUILTBLOCK_TIME_LIMIT_S=60`, `QUILTBLOCK_EFFORT=medium|high`), or move
   only `generate` to another host.
2. **DK: rotate the API key** (it was pasted in chat) and confirm the QuiltBlock workspace spend limit.
3. Generator quality: a small eval set (10-20 prompts and photos, including Mom's) to compare effort
   levels/models; maybe a non-AI photo -> grid pre-pass before Claude.
4. Planner gaps from Mom's pile: row/column quilts and samplers (~10 patterns), then pieced sashing and
   cornerstones, unit borders, larger stitch-and-flip corners, on-point. See pattern-pile.md.
5. Mom reviews the 36 pile blocks (and the 6 earlier hand-drawn ones) and the ½" labelling.
6. Payments: Stripe Checkout or a merchant of record (Lemon Squeezy) - account in Mom's/business name.
   Print-and-mail later via the Lulu Print API (needs a print-ready booklet PDF, pages in multiples of 4).
7. Smaller: business name (placeholder in repo name, title, LICENSE); bear paw / maple leaf decompositions;
   hexagon "diamonds"/"double-garden" checked by eye; TetonTopo/quiltblock-archive to inspect then delete
   (gh lacks delete scope - GitHub UI).

## Gotchas that cost time before

- Files are CRLF; edit with the Edit tool or Node scripts that normalise line endings. Bash heredocs and
  `node -e` mangle backslashes and backticks - write a script file instead.
- Netlify MCP env vars: passing scopes or a secret flag fails silently on the free plan - set plain values,
  then verify with getAllEnvVars. Updating an existing var can 422: delete and recreate.
- Netlify Blobs must not hold read-modify-write counters: limits.js writes one record per request.
- Current Opus rejects forced `tool_choice` and `budget_tokens`; default effort on Opus 5.5 is medium, set it.
- PDFs from the scanner are plain JPEG streams: extract with a byte scan for "stream" + FF D8 FF into a
  SHORT path (Windows 260-char limit), then view the JPEGs.
