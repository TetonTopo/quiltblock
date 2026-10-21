# Deploying, and where the API key goes

The site is static files plus two serverless functions. There is no build step.

## The one rule about the key

`ANTHROPIC_API_KEY` is read by `netlify/functions/generate.js`, which runs on the
server. It is never sent to the browser and never appears in the repo.

A key in front-end code is readable by anyone who opens the page — "minified" or
"obfuscated" does not change that — and anyone who finds it can spend against it
until it is revoked. Every generation request goes through the function, which
is also the only place that can rate-limit, cap, or log them.

`.env` is gitignored. If a key ever does land in a commit, revoke it first and
rewrite history second; a revoked key is harmless and a rewritten history that
still contains a live key is not.

## Netlify

1. Push the repo to GitHub.
2. In Netlify, add a new site from that repository. `netlify.toml` already sets
   the publish directory and the functions directory, so the defaults are right.
3. **Site settings → Environment variables** → add `ANTHROPIC_API_KEY`, scoped
   to Functions, marked secret. The settings below are optional.
4. Deploy (or redeploy - variables are frozen per deploy).

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns the live generator on. Server only. |
| `QUILTBLOCK_ACCESS_CODE` | none | While testing: only people with this code can generate. The page asks for it. Remove it to open the generator to everyone. |
| `QUILTBLOCK_PER_IP_HOURLY` | 6 | Designs per visitor per hour. |
| `QUILTBLOCK_DAILY_CAP` | 60 | Designs for the whole site per day (UTC). The real spend ceiling. |
| `QUILTBLOCK_GENERATOR` | on | `off` switches the live generator off without removing the key. |
| `QUILTBLOCK_EFFORT` | medium | low / medium / high. Higher thinks longer: better blocks, slower, dearer. Netlify stops a function at 60 seconds. |
| `QUILTBLOCK_MODEL` | claude-opus-5-5 | Pin a different model. |
| `QUILTBLOCK_HASH_SALT` | quiltblock | Salt for the hashed visitor IPs in the rate-limit records. |

The storefront probes `GET /.netlify/functions/generate` on load and shows
either "live" or "stand-in generator" in the custom-block header, so it is
obvious which mode the deployed site is in.

Locally:

```bash
npm install
npm install -g netlify-cli
netlify dev
```

`netlify dev` serves the static files and the functions together, so the
generator works end to end against a key in `.env`.

Without the CLI, `npx serve .` runs everything except the functions, and the
storefront falls back to the stand-in generator.

## Other hosts

`generate.js` uses the standard web `Request` -> `Response` handler, which
Vercel and Cloudflare also speak; only the Netlify Blobs store behind the rate
limits would need replacing. `checkout.js` still uses the older Lambda-style
signature.

GitHub Pages will serve the static site fine, but it cannot run the functions,
so the generator stays in stand-in mode there.

## Cost

Each generation is one or two model calls. The system prompt is marked for
prompt caching, so repeated requests pay the cached rate on the instructions and
only full price on the description.

Guards in place:

- `max_tokens` is capped, the prompt is truncated at 600 characters, grid size
  and fabric count are clamped, photos are shrunk in the browser and refused
  over about 4 MB, and there are at most two attempts - the second only if it
  can finish inside Netlify's 60 seconds.
- **Rate limits** (`netlify/lib/limits.js`): per visitor per hour and per site
  per day, kept in Netlify Blobs as append-only records (one per request, so
  simultaneous requests cannot lose a count). Visitor IPs are stored only as
  salted hashes. Attempts are counted, not successes. If the store cannot be
  reached the generator refuses rather than running unlimited.
- **An access code** for the testing period, and a kill switch.
- Each day's records carry the tokens each request used, so the spend can be
  read back from **Data & Storage → Blobs → generator-limits** in Netlify.

At Claude Opus 5.5 list prices ($4 in / $20 out per million tokens) a design
is roughly 3-6 cents with a photo, so the default daily cap of 60 is a ceiling
of a few dollars a day. Still to do before a fully public launch: abuse
handling for prompts that are not quilt blocks.

## Testing the generator before it is live

`tools/try-generate.mjs` runs the real generator from a laptop, with nothing
deployed and no rate limits:

```bash
npm install
# put ANTHROPIC_API_KEY=... in .env (gitignored)
node tools/try-generate.mjs "a cow with skis on"
node tools/try-generate.mjs "her cat" C:photoscat.jpg --tier intermediate --fabrics 5
```

Add `--live --code <tester code>` to send the same request to the deployed
site instead (no key on the laptop; the site's limits apply).

It prints the time, the tokens and the cost of each run, and writes the
block's JSON and SVG next to the photo.
