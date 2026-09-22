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
3. **Site settings → Environment variables** → add `ANTHROPIC_API_KEY`.
   Optionally add `QUILTBLOCK_MODEL` to pin a different model; the default is
   `claude-opus-5`.
4. Deploy.

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

The functions use the Netlify handler signature (`event.httpMethod`,
`event.body`, returning `{ statusCode, headers, body }`). Moving to Vercel or
Cloudflare means adapting that signature — the body of each function is portable.

GitHub Pages will serve the static site fine, but it cannot run the functions,
so the generator stays in stand-in mode there.

## Cost

Each generation is one or two model calls. The system prompt is marked for
prompt caching, so repeated requests pay the cached rate on the instructions and
only full price on the description.

Guards already in place: `max_tokens` is capped, the prompt is truncated at 600
characters, grid size and fabric count are clamped, and the retry loop stops
after two attempts.

What is **not** in place and would be needed before pointing the public at it:

- Per-IP or per-session rate limiting. Serverless functions have no shared
  memory, so this needs a store (Netlify Blobs, Upstash, a database).
- A daily spend ceiling.
- Abuse handling for prompts that are not quilt blocks.

Until those exist, either keep the deployed site on the stand-in generator or
put the live one behind a password.
