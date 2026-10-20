/**
 * Who may spend money on the generator, and how fast.
 *
 * Three gates, checked before the model is called:
 *
 *   1. A kill switch. QUILTBLOCK_GENERATOR=off turns the live generator off
 *      without touching the API key.
 *   2. An access code. While the shop is being tested, set
 *      QUILTBLOCK_ACCESS_CODE and only people who have it can generate. Leave
 *      it unset once the shop is open.
 *   3. Rate limits: a few requests per visitor per hour, and a ceiling for the
 *      whole site per day, so a stuck script or a curious crowd cannot run up
 *      a bill. Both are environment variables.
 *
 * The counts live in Netlify Blobs, append-only: every request writes its own
 * small record under keys like `ip/<hash>/<time>` and `day/<date>/<time>`,
 * and a limit is the number of records under a prefix in the window. Nothing
 * is ever read, incremented and written back, so two requests at once cannot
 * lose a count. The visitor's IP address is never stored, only a salted hash.
 *
 * Attempts are counted, not successes: a request that fails still cost money.
 */

export const LIMIT_DEFAULTS = {
  perIpPerHour: 6,
  perDay: 60,
};

const HOUR = 60 * 60 * 1000;

/** The limits in force, from environment variables (read through `get`). */
export function limitsFromEnv(get = () => undefined) {
  const num = (k, d) => {
    const v = Number(get(k));
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : d;
  };
  return {
    enabled: String(get('QUILTBLOCK_GENERATOR') ?? 'on').toLowerCase() !== 'off',
    accessCode: String(get('QUILTBLOCK_ACCESS_CODE') ?? '').trim(),
    perIpPerHour: num('QUILTBLOCK_PER_IP_HOURLY', LIMIT_DEFAULTS.perIpPerHour),
    perDay: num('QUILTBLOCK_DAILY_CAP', LIMIT_DEFAULTS.perDay),
    salt: String(get('QUILTBLOCK_HASH_SALT') ?? 'quiltblock'),
  };
}

/** Compare two strings without leaking how much of them matched. */
export function sameCode(given, wanted) {
  const a = String(given ?? '');
  const b = String(wanted ?? '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** A salted SHA-256 of the visitor's IP, as hex. */
export async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt}:${ip ?? 'unknown'}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const stampOf = (key) => Number(String(key).split('/').pop().split('-')[0]);

/**
 * Check the limits and, if the request may go ahead, record it.
 *
 * @param store  anything with `list({ prefix })` -> `{ blobs: [{ key }] }`,
 *               `setJSON(key, value)` and `delete(key)` - a Netlify Blobs
 *               store in production, `memoryStore()` in tests
 * @returns `{ ok: true, record }` or `{ ok: false, status, error, retryAfter }`
 */
export async function admit(store, { ipHash, limits, now = Date.now(), meta = {} }) {
  const { perIpPerHour, perDay } = limits;

  const mine = (await store.list({ prefix: `ip/${ipHash}/` })).blobs ?? [];
  const recent = mine.filter((b) => now - stampOf(b.key) < HOUR);
  // Tidy as we go: anything older than the window no longer counts.
  await Promise.all(mine.filter((b) => now - stampOf(b.key) >= HOUR).map((b) => store.delete(b.key).catch(() => {})));

  if (recent.length >= perIpPerHour) {
    const oldest = Math.min(...recent.map((b) => stampOf(b.key)));
    const retryAfter = Math.max(1, Math.ceil((oldest + HOUR - now) / 1000));
    return {
      ok: false,
      status: 429,
      error: `That is ${perIpPerHour} designs in the last hour, which is the limit for now. Try again in about ${Math.ceil(retryAfter / 60)} minutes.`,
      retryAfter,
    };
  }

  const today = (await store.list({ prefix: `day/${dayOf(now)}/` })).blobs ?? [];
  if (today.length >= perDay) {
    const midnight = Date.parse(`${dayOf(now)}T00:00:00Z`) + 24 * HOUR;
    return {
      ok: false,
      status: 429,
      error: 'The generator has done all the designs it is allowed today. It opens again tomorrow.',
      retryAfter: Math.max(1, Math.ceil((midnight - now) / 1000)),
    };
  }

  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { at: new Date(now).toISOString(), ...meta };
  await store.setJSON(`ip/${ipHash}/${id}`, record);
  await store.setJSON(`day/${dayOf(now)}/${id}`, record);
  return { ok: true, record: { key: `day/${dayOf(now)}/${id}`, ...record } };
}

/** Note how a request went (attempts, tokens) on its day record, for the log. */
export async function finish(store, record, outcome) {
  if (!record?.key) return;
  const { key, ...rest } = record;
  await store.setJSON(key, { ...rest, ...outcome, finished: new Date().toISOString() }).catch(() => {});
}

/** The same interface as a Blobs store, in memory. For tests and local runs. */
export function memoryStore() {
  const data = new Map();
  return {
    data,
    async list({ prefix = '' } = {}) {
      return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
    async setJSON(key, value) {
      data.set(key, JSON.parse(JSON.stringify(value)));
      return { modified: true };
    },
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async delete(key) {
      data.delete(key);
    },
  };
}
