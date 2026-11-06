import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth';
import { recomputeDecaying, recomputePhoneStats } from '../src/stats';

const BASE = 'https://api.test/api/v1';
let ipCounter = 0;
// Mỗi request một IP giả khác nhau để rate limit theo IP không ảnh hưởng chéo giữa các test.
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;
let phoneCounter = 0;
// Số giả duy nhất cho mỗi test. Dải 0388xxxxxx chỉ dùng trong test.
const freshPhone = () => `0388${String(100000 + phoneCounter++).padStart(6, '0')}`;

async function call(path: string, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', init.ip ?? nextIp());
  const res = await exports.default.fetch(new Request(BASE + path, { ...init, headers }));
  const body = (await res.json()) as any;
  return { status: res.status, body, headers: res.headers };
}

async function install(): Promise<string> {
  const r = await call('/install', { method: 'POST' });
  expect(r.status).toBe(201);
  return r.body.data.token as string;
}

/** Tài khoản đã tạo từ 30 ngày trước, tức đã qua thời gian làm quen (WARMUP_DAYS). */
async function installEstablished(): Promise<string> {
  const token = await install();
  await env.DB.prepare('UPDATE reporters SET created_at = created_at - 30 * 86400 WHERE token_hash = ?1')
    .bind(await hashToken(env, token))
    .run();
  return token;
}

function report(token: string, body: Record<string, unknown>, ip?: string) {
  return call('/reports', {
    method: 'POST',
    ip,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'android', ...body }),
  });
}

const lookup = (phone: string) => call(`/lookup/${encodeURIComponent(phone)}`);

describe('POST /install', () => {
  it('returns a token once and stores only its HMAC', async () => {
    const token = await install();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await env.DB.prepare('SELECT token_hash FROM reporters').all<{ token_hash: string }>();
    expect(rows.results.some((r) => r.token_hash === token)).toBe(false);
    expect(rows.results.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });

  it('is rate limited per IP', async () => {
    const ip = '203.0.113.77';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await call('/install', { method: 'POST', ip })).status);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses).toContain(429);
  });
});

describe('POST /reports: auth and validation', () => {
  it('rejects missing, malformed and unknown tokens', async () => {
    const body = JSON.stringify({ phone: freshPhone(), label: 'scam', source: 'android' });
    const h = { 'Content-Type': 'application/json' };
    expect((await call('/reports', { method: 'POST', headers: h, body })).status).toBe(401);
    expect((await call('/reports', { method: 'POST', headers: { ...h, Authorization: 'Bearer abc' }, body })).status).toBe(401);
    const unknown = 'A'.repeat(43);
    expect((await call('/reports', { method: 'POST', headers: { ...h, Authorization: `Bearer ${unknown}` }, body })).status).toBe(401);
  });

  it('rejects banned reporters', async () => {
    const token = await install();
    await env.DB.prepare('UPDATE reporters SET banned = 1').run();
    const r = await report(token, { phone: freshPhone(), label: 'scam' });
    expect(r.status).toBe(403);
    await env.DB.prepare('UPDATE reporters SET banned = 0').run();
  });

  it.each([
    [{ phone: '0412345678', label: 'scam' }, 'invalid_phone'],
    [{ phone: '0912abc', label: 'scam' }, 'invalid_phone'],
    [{ phone: '0388000001', label: 'fraud' }, 'invalid_request'],
    [{ phone: '0388000001', label: 'scam', extra: 1 }, 'invalid_request'],
    [{ phone: '0388000001', label: 'scam', scenario: 'unknown_scenario' }, 'invalid_request'],
    [{ phone: '0388000001', label: 'scam', called_at: 'yesterday' }, 'invalid_request'],
    [{ phone: '0388000001', label: 'scam', called_at: '2020-01-01T00:00:00Z' }, 'invalid_called_at'],
  ])('rejects %j with %s', async (body, code) => {
    const token = await install();
    const r = await report(token, body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(code);
  });

  it('rejects non-JSON bodies', async () => {
    const token = await install();
    const r = await call('/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(r.body.error.code).toBe('invalid_json');
  });
});

describe('reporting and lookup', () => {
  it('an unknown number is insufficient with zero counts', async () => {
    const r = await lookup(freshPhone());
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ risk_level: 'insufficient', total_reports: 0, unique_reporters: 0, under_review: false });
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=120');
  });

  it('rejects an invalid number on lookup', async () => {
    expect((await lookup('12')).status).toBe(400);
  });

  it('normalizes the number: different spellings count for the same E.164', async () => {
    const phone = freshPhone(); // 0388xxxxxx
    const a = await install();
    const b = await install();
    await report(a, { phone, label: 'scam' });
    await report(b, { phone: `+84 ${phone.slice(1, 4)} ${phone.slice(4)}`, label: 'scam' });
    const r = await lookup(phone);
    expect(r.body.data.phone).toBe(`+84${phone.slice(1)}`);
    expect(r.body.data.unique_reporters).toBe(2);
  });

  it('reaches high with 5 independent scam reporters, insufficient below 3', async () => {
    const phone = freshPhone();
    const tokens = await Promise.all(Array.from({ length: 5 }, installEstablished));
    for (const [i, t] of tokens.entries()) {
      await report(t, { phone, label: 'scam', scenario: i < 3 ? 'fake_police' : 'investment' });
      const level = (await lookup(phone)).body.data.risk_level;
      if (i < 2) expect(level).toBe('insufficient');
    }
    const d = (await lookup(phone)).body.data;
    expect(d).toMatchObject({ risk_level: 'high', scam_reports: 5, unique_scam_reporters: 5 });
    expect(d.top_scenarios).toEqual([
      { key: 'fake_police', count: 3 },
      { key: 'investment', count: 2 },
    ]);
    expect(d.first_reported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('new accounts reach only medium until 5 established accounts agree', async () => {
    const phone = freshPhone();
    const fresh = await Promise.all(Array.from({ length: 8 }, install));
    for (const t of fresh) await report(t, { phone, label: 'scam' });
    // 8 tài khoản mới: score 4, tỷ lệ 1.0, nhưng chưa ai qua thời gian làm quen.
    expect((await lookup(phone)).body.data).toMatchObject({ risk_level: 'medium', unique_scam_reporters: 8 });
    const old = await Promise.all(Array.from({ length: 5 }, installEstablished));
    for (const t of old) await report(t, { phone, label: 'scam' });
    expect((await lookup(phone)).body.data.risk_level).toBe('high');
  });

  it('cron upgrades votes from new accounts once they pass the warm-up period', async () => {
    const phone = freshPhone();
    const e164 = `+84${phone.slice(1)}`;
    const fresh = await Promise.all(Array.from({ length: 5 }, install));
    for (const t of fresh) await report(t, { phone, label: 'scam' });
    expect((await lookup(phone)).body.data.risk_level).toBe('medium');
    // 4 ngày sau, không có báo cáo mới: 5 × 0.5^(4/30) = 4.56 → high.
    await recomputeDecaying(env, Math.floor(Date.now() / 1000) + 4 * 86_400);
    expect((await lookup(phone)).body.data.risk_level).toBe('high');
    expect((await env.DB.prepare('SELECT score FROM phone_stats WHERE phone = ?1').bind(e164).first<{ score: number }>())!.score)
      .toBeCloseTo(5 * Math.pow(0.5, 4 / 30), 2);
  });

  it('dedupes the same label from the same reporter on the same day', async () => {
    const phone = freshPhone();
    const t = await install();
    expect((await report(t, { phone, label: 'scam' })).status).toBe(201);
    const dup = await report(t, { phone, label: 'scam' });
    expect(dup.status).toBe(200);
    expect(dup.body.data).toEqual({ accepted: false, reason: 'duplicate' });
    expect((await lookup(phone)).body.data.total_reports).toBe(1);
  });

  it("counts only each reporter's latest vote, even within the same second", async () => {
    const phone = freshPhone();
    const t = await installEstablished();
    await report(t, { phone, label: 'scam' });
    await report(t, { phone, label: 'safe' });
    const d = (await lookup(phone)).body.data;
    expect(d.total_reports).toBe(2); // lượt ghi nhận thô
    expect(d.unique_reporters).toBe(1);
    expect(d.unique_scam_reporters).toBe(0);
    const s = await env.DB.prepare('SELECT score FROM phone_stats WHERE phone = ?1').bind(`+84${phone.slice(1)}`).first<{ score: number }>();
    expect(s?.score).toBe(-1);
  });

  it('caps high at medium while a dispute is open', async () => {
    const phone = freshPhone();
    const e164 = `+84${phone.slice(1)}`;
    const tokens = await Promise.all(Array.from({ length: 6 }, installEstablished));
    for (const t of tokens.slice(0, 5)) await report(t, { phone, label: 'scam' });
    expect((await lookup(phone)).body.data.risk_level).toBe('high');
    await env.DB.prepare('UPDATE phone_stats SET under_review = 1 WHERE phone = ?1').bind(e164).run();
    await report(tokens[5]!, { phone, label: 'scam' }); // tính lại
    const d = (await lookup(phone)).body.data;
    expect(d).toMatchObject({ risk_level: 'medium', under_review: true, unique_scam_reporters: 6 });
  });

  it('ignores hidden reports and banned reporters', async () => {
    const phone = freshPhone();
    const e164 = `+84${phone.slice(1)}`;
    const tokens = await Promise.all(Array.from({ length: 5 }, installEstablished));
    for (const t of tokens) await report(t, { phone, label: 'scam' });
    expect((await lookup(phone)).body.data.risk_level).toBe('high');
    await env.DB.prepare(
      `UPDATE reports SET status = 'hidden' WHERE rowid = (SELECT rowid FROM reports WHERE phone = ?1 LIMIT 1)`,
    ).bind(e164).run();
    await recomputePhoneStats(env, e164, Math.floor(Date.now() / 1000));
    expect((await lookup(phone)).body.data).toMatchObject({ risk_level: 'medium', unique_scam_reporters: 4 });

    // Cấm một reporter còn lại: phiếu của họ không còn được tính.
    await env.DB.prepare(
      `UPDATE reporters SET banned = 1 WHERE id = (
         SELECT reporter_id FROM reports WHERE phone = ?1 AND status = 'active' LIMIT 1)`,
    ).bind(e164).run();
    await recomputePhoneStats(env, e164, Math.floor(Date.now() / 1000));
    expect((await lookup(phone)).body.data).toMatchObject({ unique_scam_reporters: 3, scam_reports: 3 });
  });

  it('stores the note sanitized, never the raw phone number or email', async () => {
    const phone = freshPhone();
    const t = await install();
    await report(t, { phone, label: 'scam', note: 'Gọi từ 0912 345 678, mail x@y.vn, đòi 5.000.000đ' });
    const row = await env.DB.prepare('SELECT note FROM reports WHERE phone = ?1').bind(`+84${phone.slice(1)}`).first<{ note: string }>();
    expect(row?.note).toBe('Gọi từ [đã ẩn], mail [đã ẩn] đòi 5.000.000đ');
  });

  it('limits each reporter to 10 reports per hour', async () => {
    const t = await install();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await report(t, { phone: freshPhone(), label: 'spam' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('never stores the client IP', async () => {
    const ip = '192.0.2.123';
    const t = await install();
    await report(t, { phone: freshPhone(), label: 'scam', note: 'test' }, ip);
    const tables = ['reporters', 'reports', 'phone_stats', 'disputes'];
    for (const table of tables) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(results)).not.toContain(ip);
    }
  });
});

describe('GET /sync/numbers', () => {
  it('requires an install token', async () => {
    expect((await call('/sync/numbers')).status).toBe(401);
  });

  it('full sync lists only medium/high; delta includes downgrades; cursor pages through', async () => {
    const reader = await install();
    const auth = { headers: { Authorization: `Bearer ${reader}` } };
    const before = (await call('/sync/numbers', auth)).body.data.items.length;

    // 3 số high mới, 1 số chỉ có 1 người báo (insufficient).
    const highs = [freshPhone(), freshPhone(), freshPhone()];
    for (const phone of highs) {
      const tokens = await Promise.all(Array.from({ length: 5 }, installEstablished));
      for (const t of tokens) await report(t, { phone, label: 'scam' });
    }
    const lone = freshPhone();
    await report(await install(), { phone: lone, label: 'scam' });

    const full = (await call('/sync/numbers', auth)).body.data;
    const phones = full.items.map((i: any) => i.phone);
    expect(phones.length - before).toBe(3);
    for (const p of highs) expect(phones).toContain(`+84${p.slice(1)}`);
    expect(phones).not.toContain(`+84${lone.slice(1)}`);
    expect(full.items.every((i: any) => ['medium', 'high'].includes(i.risk_level))).toBe(true);

    // Phân trang: limit=1 phải đi qua đủ số phần tử, không trùng.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page: any = (await call(`/sync/numbers?limit=1${q}`, auth)).body.data;
      seen.push(...page.items.map((i: any) => i.phone));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(phones);

    // Delta: một số high bị hạ (báo cáo bị ẩn) phải xuất hiện kèm mức mới để app xóa.
    const since = full.server_time;
    const e164 = `+84${highs[0]!.slice(1)}`;
    await env.DB.prepare(`UPDATE reports SET status = 'hidden' WHERE phone = ?1`).bind(e164).run();
    await recomputePhoneStats(env, e164, since + 5);
    const delta = (await call(`/sync/numbers?since=${since}`, auth)).body.data.items;
    expect(delta).toContainEqual(expect.objectContaining({ phone: e164, risk_level: 'insufficient' }));
  });

  it.each(['since=abc', 'cursor=bad', 'limit=0', 'limit=1001', 'limit=1.5'])('rejects %s', async (q) => {
    const t = await install();
    const r = await call(`/sync/numbers?${q}`, { headers: { Authorization: `Bearer ${t}` } });
    expect(r.status).toBe(400);
  });
});

describe('cron: time decay', () => {
  it('downgrades a number whose reports have aged', async () => {
    const phone = freshPhone();
    const e164 = `+84${phone.slice(1)}`;
    const tokens = await Promise.all(Array.from({ length: 6 }, installEstablished));
    for (const t of tokens) await report(t, { phone, label: 'scam' });
    expect((await lookup(phone)).body.data.risk_level).toBe('high');
    // 120 ngày sau: 6 × 0.5^4 = 0.375 → low.
    await recomputeDecaying(env, Math.floor(Date.now() / 1000) + 120 * 86_400);
    expect((await lookup(phone)).body.data.risk_level).toBe('low');
  });
});

describe('errors', () => {
  it('unknown routes return the error envelope', async () => {
    const r = await call('/nope');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });
});
