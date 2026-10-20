/**
 * Tests for the live generator and its gates. Node only: generate.js imports
 * the Anthropic SDK. No test here calls the API - the model is a stub that
 * plays back canned responses, and the request it was sent is checked.
 *
 * Run with the rest of the suite: node packages/pattern-core/test/run.js
 */

import { generateBlock, useClient } from '../functions/generate.js';
import handler from '../functions/generate.js';
import { admit, memoryStore, sameCode, hashIp, limitsFromEnv, LIMIT_DEFAULTS } from '../lib/limits.js';

const results = [];
const tests = [];
let current = null;
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, e, what = 'value') => {
  current.assertions++;
  if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${what}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
};
const ok = (c, what = 'expected truthy') => {
  current.assertions++;
  if (!c) throw new Error(what);
};

/** A stub client: hands back `responses` in order and remembers each request. */
function stub(responses) {
  const sent = [];
  return {
    sent,
    beta: {
      messages: {
        async create(params, opts) {
          sent.push({ params: JSON.parse(JSON.stringify(params)), opts });
          const next = responses.shift();
          if (next instanceof Error) throw next;
          return next;
        },
      },
    },
  };
}

const STAR = {
  name: 'Test star',
  subject: 'Stars',
  blurb: 'A star.',
  fabrics: [
    { key: 'k', name: 'Oatmeal', hex: '#E7DDCB' },
    { key: 's', name: 'Indigo', hex: '#2F4A7A' },
    { key: 'c', name: 'Red', hex: '#B8453A' },
  ],
  accent: 's',
  background: 'k',
  rows: ['k kvs . k', 'k>s c c k<s', '. c c .', 'k k^s . k'],
  notes: 'Kept it simple.',
};
const BROKEN = { ...STAR, rows: ['k k', 'k'] };

const drafted = (input, id = 'tu_1') => ({
  model: 'claude-opus-5-5',
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'draft_block', input }],
  usage: { input_tokens: 1000, output_tokens: 400 },
});
const said = (text) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: { input_tokens: 900, output_tokens: 50 },
});

// ----------------------------------------------------------- the model call

test('a good first draft comes straight back, built and checked', async () => {
  const c = stub([drafted(STAR)]);
  const r = await generateBlock({ prompt: 'a star', tier: 'confident', blockSize: 12 }, { client: c });
  eq(r.status, 200, 'status');
  eq(r.body.attempts, 1, 'one attempt');
  eq(r.body.block.name, 'Test star', 'the block');
  eq(r.body.usage, { input_tokens: 1000, output_tokens: 400 }, 'usage is reported');
  const p = c.sent[0].params;
  eq(p.model, 'claude-opus-5-5', 'current default model');
  eq(p.tool_choice, { type: 'auto' }, 'no forced tool choice (current models reject it)');
  eq(p.output_config, { effort: 'medium' }, 'medium effort by default');
  eq([p.fallbacks, p.betas], ['default', ['server-side-fallback-2026-07-01']], 'refusal fallback on');
  ok(p.tools[0].strict === true, 'strict tool schema');
  ok(c.sent[0].opts.timeout <= 55_000, 'the call carries the deadline');
});

test('a draft that breaks a rule goes back once with the reason', async () => {
  const c = stub([drafted(BROKEN, 'tu_1'), drafted(STAR, 'tu_2')]);
  const r = await generateBlock({ prompt: 'a star', tier: 'confident' }, { client: c });
  eq([r.status, r.body.attempts], [200, 2], 'fixed on the second try');
  const second = c.sent[1].params.messages;
  const result = second[second.length - 1].content[0];
  eq([result.type, result.tool_use_id, result.is_error], ['tool_result', 'tu_1', true], 'answered as a failed tool call');
  ok(result.content.includes('rejected'), 'with the reason in words');
  eq(r.body.usage.output_tokens, 800, 'usage adds up across attempts');
});

test('two bad drafts give an error, not a pattern', async () => {
  const c = stub([drafted(BROKEN, 'a'), drafted(BROKEN, 'b')]);
  const r = await generateBlock({ prompt: 'x', tier: 'confident' }, { client: c });
  eq(r.status, 422, 'refused');
  eq(r.body.attempts.length, 2, 'both reasons kept');
});

test('a reply with no draft is nudged once', async () => {
  const c = stub([said('Here is my idea...'), drafted(STAR)]);
  const r = await generateBlock({ prompt: 'a star', tier: 'confident' }, { client: c });
  eq([r.status, r.body.attempts], [200, 2], 'second time it drafts');
  const last = c.sent[1].params.messages.at(-1);
  ok(String(last.content).includes('draft_block'), 'asked to call the tool');
});

test('a refusal is reported with its category', async () => {
  const c = stub([{ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [], usage: {} }]);
  const r = await generateBlock({ prompt: 'x' }, { client: c });
  eq([r.status, r.body.category], [422, 'cyber'], 'refusal');
});

test('no second attempt when the clock is nearly out', async () => {
  let t = 0;
  const now = () => t;
  const c = stub([drafted(BROKEN)]);
  c.beta.messages.create = (orig => async (...args) => { t += 40_000; return orig(...args); })(c.beta.messages.create);
  const r = await generateBlock({ prompt: 'x', tier: 'confident' }, { client: c, now });
  eq(r.status, 422, 'an honest error');
  ok(r.body.attempts.some((a) => a.includes('Ran out of time')), 'says why');
  eq(c.sent.length, 1, 'only one call made');
});

test('bad requests are refused before the model is called', async () => {
  const c = stub([]);
  eq((await generateBlock({}, { client: c })).status, 400, 'nothing to draw');
  const big = { media_type: 'image/jpeg', data: 'A'.repeat(6_000_000) };
  eq((await generateBlock({ prompt: 'x', photo: big }, { client: c })).status, 413, 'photo too big');
  eq(c.sent.length, 0, 'no call made');
});

test('a photo goes to the model ahead of the words', async () => {
  const c = stub([drafted(STAR)]);
  await generateBlock({ prompt: 'my cat', photo: { media_type: 'image/jpeg', data: 'abc' }, tier: 'confident' }, { client: c });
  const content = c.sent[0].params.messages[0].content;
  eq([content[0].type, content[1].type], ['image', 'text'], 'image first');
  ok(content[1].text.startsWith('Turn the photo above'), 'and the text refers to it');
});

test('API errors come back as errors, 429 kept as 429', async () => {
  const busy = Object.assign(new Error('rate limited'), { status: 429 });
  eq((await generateBlock({ prompt: 'x' }, { client: stub([busy]) })).status, 429, 'busy');
  const boom = Object.assign(new Error('overloaded'), { status: 529 });
  eq((await generateBlock({ prompt: 'x' }, { client: stub([boom]) })).status, 502, 'failed');
});

// ------------------------------------------------------------------ limits

test('limits come from the environment, with sane defaults', () => {
  const d = limitsFromEnv(() => undefined);
  eq([d.enabled, d.accessCode, d.perIpPerHour, d.perDay], [true, '', LIMIT_DEFAULTS.perIpPerHour, LIMIT_DEFAULTS.perDay], 'defaults');
  const e = { QUILTBLOCK_GENERATOR: 'OFF', QUILTBLOCK_ACCESS_CODE: ' quilt ', QUILTBLOCK_PER_IP_HOURLY: '2', QUILTBLOCK_DAILY_CAP: 'lots' };
  const l = limitsFromEnv((k) => e[k]);
  eq([l.enabled, l.accessCode, l.perIpPerHour, l.perDay], [false, 'quilt', 2, LIMIT_DEFAULTS.perDay], 'overrides, junk ignored');
});

test('each visitor gets a few designs an hour', async () => {
  const store = memoryStore();
  const limits = { perIpPerHour: 2, perDay: 100 };
  const t0 = Date.parse('2026-10-20T12:00:00Z');
  ok((await admit(store, { ipHash: 'a', limits, now: t0 })).ok, 'first');
  ok((await admit(store, { ipHash: 'a', limits, now: t0 + 1000 })).ok, 'second');
  const third = await admit(store, { ipHash: 'a', limits, now: t0 + 2000 });
  eq([third.ok, third.status], [false, 429], 'third refused');
  ok(third.retryAfter > 3500 && third.retryAfter <= 3600, `retry in about an hour (${third.retryAfter}s)`);
  ok((await admit(store, { ipHash: 'b', limits, now: t0 + 3000 })).ok, 'someone else is fine');
  ok((await admit(store, { ipHash: 'a', limits, now: t0 + 3601_000 })).ok, 'and the first visitor again after an hour');
  eq((await store.list({ prefix: 'ip/a/' })).blobs.length, 1, 'old records are tidied away');
});

test('the whole site stops at the daily cap', async () => {
  const store = memoryStore();
  const limits = { perIpPerHour: 100, perDay: 3 };
  const t0 = Date.parse('2026-10-20T23:00:00Z');
  for (const ip of ['a', 'b', 'c']) ok((await admit(store, { ipHash: ip, limits, now: t0 })).ok, ip);
  const late = await admit(store, { ipHash: 'd', limits, now: t0 + 1000 });
  eq([late.ok, late.status], [false, 429], 'fourth refused');
  ok(late.retryAfter <= 3600, 'until midnight UTC');
  ok((await admit(store, { ipHash: 'd', limits, now: t0 + 3600_000 })).ok, 'a new day');
});

test('codes compare exactly and IPs are hashed, never stored', async () => {
  ok(sameCode('quilt', 'quilt') && !sameCode('quil', 'quilt') && !sameCode('', 'quilt'), 'exact match only');
  const h = await hashIp('203.0.113.9', 'salt');
  ok(/^[0-9a-f]{32}$/.test(h) && !h.includes('203'), 'a hash');
  ok(h !== (await hashIp('203.0.113.9', 'other')), 'salted');
});

// ----------------------------------------------------------------- handler

test('the endpoint enforces the code and the limits before spending anything', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    let r = await handler(new Request('http://x/', { method: 'GET' }));
    eq((await r.json()).available, false, 'no key, not available');

    Object.assign(process.env, {
      ANTHROPIC_API_KEY: 'test-not-a-real-key',
      QUILTBLOCK_ACCESS_CODE: 'patchwork',
      QUILTBLOCK_PER_IP_HOURLY: '1',
    });
    r = await handler(new Request('http://x/', { method: 'GET' }));
    const status = await r.json();
    eq([status.available, status.needsCode, status.model], [true, true, 'claude-opus-5-5'], 'live, needs a code');

    const c = stub([drafted(STAR)]);
    useClient(c);
    const post = (code) =>
      handler(
        new Request('http://x/', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(code ? { 'x-quiltblock-code': code } : {}) },
          body: JSON.stringify({ prompt: 'a star', tier: 'confident' }),
        }),
        { ip: '198.51.100.7' },
      );
    eq((await post(null)).status, 401, 'no code, no design');
    eq((await post('wrong')).status, 401, 'wrong code, no design');
    eq(c.sent.length, 0, 'and the model was not called');
    r = await post('patchwork');
    eq(r.status, 200, 'right code, a design');
    r = await post('patchwork');
    eq(r.status, 429, 'over the hourly limit');
    ok(Number(r.headers.get('retry-after')) > 0, 'with a retry-after');
    eq(c.sent.length, 1, 'the refused request never reached the model');

    process.env.QUILTBLOCK_GENERATOR = 'off';
    r = await handler(new Request('http://x/', { method: 'GET' }));
    eq((await r.json()).available, false, 'the kill switch works');
  } finally {
    useClient(null);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

// --------------------------------------------------------------------- run

export async function report() {
  for (const t of tests) {
    current = { name: t.name, assertions: 0, error: null };
    try {
      await t.fn();
    } catch (err) {
      current.error = err;
    }
    results.push(current);
  }
  const failed = results.filter((r) => r.error);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    assertions: results.reduce((s, r) => s + r.assertions, 0),
    failures: failed.map((r) => ({ name: r.name, message: r.error.message })),
    lines: results.map((r) => `${r.error ? 'FAIL' : 'ok'}  ${r.name}${r.error ? `\n      ${r.error.message}` : ''}`),
  };
}
