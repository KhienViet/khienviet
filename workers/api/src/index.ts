import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { normalizePhone } from '@khienviet/phone';
import { findReporter, generateToken, hashToken, type Reporter } from './auth';
import { sanitizeNote } from './sanitize';
import { LABELS, type RiskLevel } from './scoring';
import { recomputeDecaying, recomputePhoneStats } from './stats';

// Danh sách kịch bản lừa đảo. Thêm mới ở đây và trong docs/ARCHITECTURE.md mục 5.
export const SCENARIOS = [
  'fake_police',
  'fake_bank',
  'fake_telecom',
  'fake_shipper',
  'investment',
  'loan',
  'prize',
  'job_offer',
  'other',
] as const;

type AppEnv = { Bindings: Env; Variables: { reporter: Reporter } };
const app = new Hono<AppEnv>().basePath('/api/v1');

const nowSec = () => Math.floor(Date.now() / 1000);
const iso = (sec: number | null) => (sec === null ? null : new Date(sec * 1000).toISOString().replace('.000Z', 'Z'));
const fail = (c: Context, status: 400 | 401 | 403 | 404 | 429 | 500, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

// IP chỉ dùng trong bộ nhớ làm khóa rate limit, không bao giờ lưu hay log.
const clientKey = (c: Context) => c.req.header('CF-Connecting-IP') ?? 'unknown';

async function underLimit(limiter: RateLimit, key: string): Promise<boolean> {
  return (await limiter.limit({ key })).success;
}

// ---------- POST /install: app đăng ký install token ẩn danh ----------
app.post('/install', async (c) => {
  if (!(await underLimit(c.env.INSTALL_LIMITER, clientKey(c)))) {
    return fail(c, 429, 'rate_limited', 'Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  const token = generateToken();
  const hash = await hashToken(c.env, token);
  await c.env.DB.prepare(`INSERT INTO reporters (id, token_hash, created_at) VALUES (?1, ?2, ?3)`)
    .bind(crypto.randomUUID(), hash, nowSec())
    .run();
  return c.json({ data: { token } }, 201);
});

// ---------- Endpoint cần install token ----------
const requireInstall = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  const reporter = await findReporter(c.env, c.req.header('Authorization'));
  if (!reporter) return fail(c, 401, 'unauthorized', 'Thiếu hoặc sai install token.');
  if (reporter.banned) return fail(c, 403, 'forbidden', 'Thiết bị này không được phép gửi báo cáo.');
  c.set('reporter', reporter);
  await next();
};

const reportSchema = z.strictObject({
  phone: z.string().min(1).max(40),
  label: z.enum(LABELS),
  scenario: z.enum(SCENARIOS).optional(),
  note: z.string().max(2000).optional(),
  called_at: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(['android', 'ios']),
});

const MAX_CALL_AGE = 30 * 86_400;
const CLOCK_SKEW = 300;

app.post('/reports', requireInstall, async (c) => {
  if (!(await underLimit(c.env.WRITE_LIMITER, clientKey(c)))) {
    return fail(c, 429, 'rate_limited', 'Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, 'invalid_json', 'Dữ liệu gửi lên không phải JSON hợp lệ.');
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'invalid_request', 'Dữ liệu báo cáo không hợp lệ.');
  const input = parsed.data;

  const phone = normalizePhone(input.phone);
  if (!phone) return fail(c, 400, 'invalid_phone', 'Số điện thoại không hợp lệ.');

  const now = nowSec();
  let calledAt: number | null = null;
  if (input.called_at) {
    calledAt = Math.floor(Date.parse(input.called_at) / 1000);
    if (calledAt > now + CLOCK_SKEW || calledAt < now - MAX_CALL_AGE) {
      return fail(c, 400, 'invalid_called_at', 'Thời điểm cuộc gọi không hợp lệ.');
    }
  }

  const reporter = c.get('reporter');
  const limit = Number(c.env.REPORTS_PER_HOUR_PER_REPORTER);
  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?1 AND created_at > ?2`,
  )
    .bind(reporter.id, now - 3600)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= limit) {
    return fail(c, 429, 'rate_limited', 'Bạn đã gửi quá nhiều báo cáo trong một giờ.');
  }

  const id = crypto.randomUUID();
  const note = input.note === undefined ? null : sanitizeNote(input.note);
  const res = await c.env.DB.prepare(
    `INSERT INTO reports (id, phone, reporter_id, label, scenario, note, source, called_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT DO NOTHING`,
  )
    .bind(id, phone.e164, reporter.id, input.label, input.scenario ?? null, note, input.source, calledAt, now)
    .run();

  if (res.meta.changes === 0) {
    // Cùng reporter, cùng số, cùng nhãn trong cùng ngày: không tính thêm.
    return c.json({ data: { accepted: false, reason: 'duplicate' } }, 200);
  }

  await c.env.DB.prepare(`UPDATE reporters SET report_count = report_count + 1 WHERE id = ?1`).bind(reporter.id).run();
  await recomputePhoneStats(c.env, phone.e164, now);
  return c.json({ data: { accepted: true, id } }, 201);
});

// ---------- GET /lookup/:phone ----------
interface StatsRow {
  phone: string;
  total_reports: number;
  scam_reports: number;
  spam_reports: number;
  safe_reports: number;
  unique_reporters: number;
  unique_scam_reporters: number;
  risk_level: RiskLevel;
  top_scenarios: string | null;
  first_reported_at: number | null;
  last_reported_at: number | null;
  under_review: number;
}

app.get('/lookup/:phone', async (c) => {
  if (!(await underLimit(c.env.READ_LIMITER, clientKey(c)))) {
    return fail(c, 429, 'rate_limited', 'Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  const phone = normalizePhone(c.req.param('phone'));
  if (!phone) return fail(c, 400, 'invalid_phone', 'Số điện thoại không hợp lệ.');

  const row = await c.env.DB.prepare(`SELECT * FROM phone_stats WHERE phone = ?1`).bind(phone.e164).first<StatsRow>();
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({
    data: {
      phone: phone.e164,
      is_foreign: phone.isForeign,
      risk_level: row?.risk_level ?? 'insufficient',
      total_reports: row?.total_reports ?? 0,
      scam_reports: row?.scam_reports ?? 0,
      spam_reports: row?.spam_reports ?? 0,
      safe_reports: row?.safe_reports ?? 0,
      unique_reporters: row?.unique_reporters ?? 0,
      unique_scam_reporters: row?.unique_scam_reporters ?? 0,
      top_scenarios: row?.top_scenarios ? (JSON.parse(row.top_scenarios) as unknown) : [],
      first_reported_at: iso(row?.first_reported_at ?? null),
      last_reported_at: iso(row?.last_reported_at ?? null),
      under_review: row?.under_review === 1,
    },
  });
});

// ---------- GET /sync/numbers?since=<epoch>&cursor=<opaque>&limit=<1..1000> ----------
// Không có `since`: toàn bộ số medium/high. Có `since`: mọi số thay đổi từ thời điểm đó
// (kể cả số đã xuống low/insufficient, để app xóa khỏi danh sách trên máy).
const SYNC_PAGE_MAX = 1000;
const CURSOR = /^(\d{1,12})_(\+\d{8,15})$/;

app.get('/sync/numbers', requireInstall, async (c) => {
  const sinceRaw = c.req.query('since');
  const cursorRaw = c.req.query('cursor');
  const limitRaw = c.req.query('limit');
  const pageSize = limitRaw === undefined ? SYNC_PAGE_MAX : Number(limitRaw);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > SYNC_PAGE_MAX) {
    return fail(c, 400, 'invalid_limit', 'Tham số limit không hợp lệ.');
  }
  if (sinceRaw !== undefined && !/^\d{1,12}$/.test(sinceRaw)) {
    return fail(c, 400, 'invalid_since', 'Tham số since không hợp lệ.');
  }
  let cu = -1;
  let cp = '';
  if (cursorRaw !== undefined) {
    const m = CURSOR.exec(cursorRaw);
    if (!m) return fail(c, 400, 'invalid_cursor', 'Tham số cursor không hợp lệ.');
    cu = Number(m[1]);
    cp = m[2]!;
  }

  // Lấy thời điểm TRƯỚC khi truy vấn, để thay đổi xảy ra trong lúc truy vấn được lấy ở lần sau.
  const serverTime = nowSec();
  const where =
    sinceRaw === undefined ? `risk_level IN ('medium','high')` : `updated_at >= ?4`;
  const stmt = c.env.DB.prepare(
    `SELECT phone, risk_level, unique_scam_reporters, under_review, updated_at FROM phone_stats
     WHERE ${where} AND (updated_at, phone) > (?1, ?2)
     ORDER BY updated_at, phone LIMIT ?3`,
  );
  const bound =
    sinceRaw === undefined ? stmt.bind(cu, cp, pageSize) : stmt.bind(cu, cp, pageSize, Number(sinceRaw));
  const { results } = await bound.all<{
    phone: string;
    risk_level: RiskLevel;
    unique_scam_reporters: number;
    under_review: number;
    updated_at: number;
  }>();

  const last = results[results.length - 1];
  return c.json({
    data: {
      items: results.map((r) => ({
        phone: r.phone,
        risk_level: r.risk_level,
        unique_scam_reporters: r.unique_scam_reporters,
        under_review: r.under_review === 1,
      })),
      next_cursor: results.length === pageSize && last ? `${last.updated_at}_${last.phone}` : null,
      // App lưu giá trị này (từ trang đầu tiên) làm `since` cho lần đồng bộ sau.
      server_time: serverTime,
    },
  });
});

app.notFound((c) => fail(c, 404, 'not_found', 'Không tìm thấy.'));
app.onError((err, c) => {
  // Không log nội dung request (có thể chứa số điện thoại hoặc token).
  console.error('unhandled', err instanceof Error ? err.name : 'unknown');
  return fail(c, 500, 'internal', 'Lỗi máy chủ.');
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(recomputeDecaying(env, nowSec()).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
