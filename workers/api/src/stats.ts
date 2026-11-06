import { configFromEnv, scoreVotes, type Label, type Vote } from './scoring';

const TOP_SCENARIOS = 3;

interface VoteRow {
  label: Label;
  created_at: number;
  trust_score: number;
}
interface CountRow {
  total: number;
  scam: number;
  spam: number;
  safe: number;
  first_at: number | null;
  last_at: number | null;
}
interface ScenarioRow {
  scenario: string;
  count: number;
}

/**
 * Tính lại phone_stats cho một số từ các báo cáo `active` của reporter chưa bị cấm.
 * Mỗi reporter chỉ tính phiếu mới nhất (theo created_at, rồi theo thứ tự ghi).
 * Giữ nguyên `under_review` (do quy trình khiếu nại đặt).
 */
export async function recomputePhoneStats(env: Env, phone: string, now: number): Promise<void> {
  const cfg = configFromEnv(env);

  const [votesRes, countsRes, scenariosRes, existing] = await env.DB.batch([
    env.DB.prepare(
      `SELECT label, created_at, trust_score FROM (
         SELECT r.label, r.created_at, rep.trust_score,
                ROW_NUMBER() OVER (PARTITION BY r.reporter_id ORDER BY r.created_at DESC, r.rowid DESC) AS rn
         FROM reports r JOIN reporters rep ON rep.id = r.reporter_id
         WHERE r.phone = ?1 AND r.status = 'active' AND rep.banned = 0
       ) WHERE rn = 1`,
    ).bind(phone),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(r.label = 'scam'), 0) AS scam,
              COALESCE(SUM(r.label = 'spam'), 0) AS spam,
              COALESCE(SUM(r.label = 'safe'), 0) AS safe,
              MIN(r.created_at) AS first_at, MAX(r.created_at) AS last_at
       FROM reports r JOIN reporters rep ON rep.id = r.reporter_id
       WHERE r.phone = ?1 AND r.status = 'active' AND rep.banned = 0`,
    ).bind(phone),
    env.DB.prepare(
      `SELECT r.scenario AS scenario, COUNT(*) AS count
       FROM reports r JOIN reporters rep ON rep.id = r.reporter_id
       WHERE r.phone = ?1 AND r.status = 'active' AND rep.banned = 0 AND r.scenario IS NOT NULL
       GROUP BY r.scenario ORDER BY count DESC, r.scenario LIMIT ?2`,
    ).bind(phone, TOP_SCENARIOS),
    env.DB.prepare(`SELECT under_review FROM phone_stats WHERE phone = ?1`).bind(phone),
  ]);

  const votes: Vote[] = (votesRes!.results as unknown as VoteRow[]).map((r) => ({
    label: r.label,
    createdAt: r.created_at,
    trust: r.trust_score,
  }));
  const counts = (countsRes!.results as unknown as CountRow[])[0]!;
  const scenarios = scenariosRes!.results as unknown as ScenarioRow[];
  const underReview = ((existing!.results[0] as { under_review?: number } | undefined)?.under_review ?? 0) === 1;

  const s = scoreVotes(votes, now, underReview, cfg);

  // updated_at chỉ đổi khi thông tin app cần đồng bộ thay đổi (mức nguy cơ hoặc số người báo lừa đảo).
  await env.DB.prepare(
    `INSERT INTO phone_stats (phone, total_reports, scam_reports, spam_reports, safe_reports,
        unique_reporters, unique_scam_reporters, score, risk_level, top_scenarios,
        first_reported_at, last_reported_at, under_review, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
     ON CONFLICT(phone) DO UPDATE SET
        total_reports = excluded.total_reports,
        scam_reports = excluded.scam_reports,
        spam_reports = excluded.spam_reports,
        safe_reports = excluded.safe_reports,
        unique_reporters = excluded.unique_reporters,
        unique_scam_reporters = excluded.unique_scam_reporters,
        score = excluded.score,
        risk_level = excluded.risk_level,
        top_scenarios = excluded.top_scenarios,
        first_reported_at = excluded.first_reported_at,
        last_reported_at = excluded.last_reported_at,
        updated_at = CASE
          WHEN phone_stats.risk_level <> excluded.risk_level
            OR phone_stats.unique_scam_reporters <> excluded.unique_scam_reporters
          THEN excluded.updated_at ELSE phone_stats.updated_at END`,
  )
    .bind(
      phone,
      counts.total,
      counts.scam,
      counts.spam,
      counts.safe,
      s.uniqueReporters,
      s.uniqueScamReporters,
      s.score,
      s.riskLevel,
      JSON.stringify(scenarios.map((r) => ({ key: r.scenario, count: r.count }))),
      counts.first_at,
      counts.last_at,
      underReview ? 1 : 0,
      now,
    )
    .run();
}

/**
 * Cron: tính lại các số mà điểm còn có thể thay đổi theo thời gian, tức là đang
 * medium/high (cần giảm dần) hoặc có báo cáo trong 90 ngày gần đây.
 */
export async function recomputeDecaying(env: Env, now: number, batchSize = 200): Promise<number> {
  let cursor = '';
  let done = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT phone FROM phone_stats
       WHERE (risk_level IN ('medium','high') OR last_reported_at > ?1) AND phone > ?2
       ORDER BY phone LIMIT ?3`,
    )
      .bind(now - 90 * 86_400, cursor, batchSize)
      .all<{ phone: string }>();
    for (const r of results) await recomputePhoneStats(env, r.phone, now);
    done += results.length;
    if (results.length < batchSize) return done;
    cursor = results[results.length - 1]!.phone;
  }
}
