// Thuật toán điểm nguy cơ. Công thức được công khai: mọi thay đổi phải cập nhật
// docs/ARCHITECTURE.md mục 4 và trang "Cách tính điểm" trên web.

export const LABELS = ['scam', 'spam', 'safe', 'unknown'] as const;
export type Label = (typeof LABELS)[number];
export type RiskLevel = 'insufficient' | 'low' | 'medium' | 'high';

/** Phiếu mới nhất của MỘT reporter cho một số. Gọi hàm với tối đa một phiếu mỗi reporter. */
export interface Vote {
  label: Label;
  /** Unix epoch, giây. */
  createdAt: number;
  /** reporters.trust_score, 0.1 .. 3.0 */
  trust: number;
  /** reporters.created_at, Unix epoch giây. Dùng cho thời gian làm quen. */
  reporterCreatedAt: number;
}

export interface ScoringConfig {
  halfLifeDays: number;
  minReporters: number;
  scoreMedium: number;
  scoreHigh: number;
  ratioMedium: number;
  ratioHigh: number;
  highMinScamReporters: number;
  warmupDays: number;
  warmupWeight: number;
}

export interface ScoreResult {
  score: number;
  uniqueReporters: number;
  uniqueScamReporters: number;
  /** Người báo lừa đảo có tài khoản đã qua thời gian làm quen. Dùng cho ngưỡng `high`. */
  establishedScamReporters: number;
  scamRatio: number;
  riskLevel: RiskLevel;
}

const LABEL_VALUE: Record<Label, number> = { scam: 1.0, spam: 0.3, safe: -1.0, unknown: 0 };
const DAY = 86_400;

type ThresholdVars = Pick<
  Env,
  | 'SCORE_HALF_LIFE_DAYS'
  | 'SCORE_MIN_REPORTERS'
  | 'SCORE_MEDIUM'
  | 'SCORE_HIGH'
  | 'RATIO_MEDIUM'
  | 'RATIO_HIGH'
  | 'HIGH_MIN_SCAM_REPORTERS'
  | 'WARMUP_DAYS'
  | 'WARMUP_WEIGHT'
>;

/** Đọc ngưỡng từ biến môi trường. Thiếu hoặc sai thì ném lỗi: không tính điểm với ngưỡng đoán. */
export function configFromEnv(env: { [K in keyof ThresholdVars]: string }): ScoringConfig {
  const num = (name: keyof ThresholdVars, max = Infinity): number => {
    const v = Number(env[name]);
    if (env[name] === undefined || env[name] === '' || !Number.isFinite(v) || v < 0 || v > max) {
      throw new Error(`invalid scoring config: ${name}`);
    }
    return v;
  };
  return {
    halfLifeDays: num('SCORE_HALF_LIFE_DAYS'),
    minReporters: num('SCORE_MIN_REPORTERS'),
    scoreMedium: num('SCORE_MEDIUM'),
    scoreHigh: num('SCORE_HIGH'),
    ratioMedium: num('RATIO_MEDIUM'),
    ratioHigh: num('RATIO_HIGH'),
    highMinScamReporters: num('HIGH_MIN_SCAM_REPORTERS'),
    warmupDays: num('WARMUP_DAYS'),
    // Trọng số làm quen > 1 sẽ khiến tài khoản mới nặng hơn tài khoản cũ.
    warmupWeight: num('WARMUP_WEIGHT', 1),
  };
}

/**
 * w_warmup   = WARMUP_WEIGHT nếu tài khoản chưa đủ WARMUP_DAYS ngày tuổi (tính đến `now`), ngược lại 1
 * w          = 0.5^(tuổi_phiếu_ngày / half_life) × trust × w_warmup
 * score      = Σ (w × v_label)
 * scam_ratio = Σ w(phiếu scam) / Σ w(mọi phiếu)
 * Mức `high` còn cần đủ HIGH_MIN_SCAM_REPORTERS người báo lừa đảo có tài khoản đã qua thời gian làm quen.
 * Nếu số đang có khiếu nại (underReview), mức `high` bị hạ xuống `medium`:
 * giao diện hiển thị "Đang xem xét", và app không tự động chặn.
 */
export function scoreVotes(votes: Vote[], now: number, underReview: boolean, cfg: ScoringConfig): ScoreResult {
  let score = 0;
  let totalWeight = 0;
  let scamWeight = 0;
  let uniqueScamReporters = 0;
  let establishedScamReporters = 0;
  for (const v of votes) {
    const ageDays = Math.max(0, now - v.createdAt) / DAY; // phiếu "ở tương lai" (lệch giờ) tính như mới
    const wTime = Math.pow(0.5, ageDays / cfg.halfLifeDays);
    // Tuổi tài khoản tính tại thời điểm tính điểm (không phải lúc bỏ phiếu), để người dùng thật
    // báo ngay sau khi cài app vẫn được đủ trọng số khi tài khoản qua thời gian làm quen.
    const established = now - v.reporterCreatedAt >= cfg.warmupDays * DAY;
    const w = wTime * v.trust * (established ? 1 : cfg.warmupWeight);
    score += w * LABEL_VALUE[v.label];
    totalWeight += w;
    if (v.label === 'scam') {
      scamWeight += w;
      uniqueScamReporters++;
      if (established) establishedScamReporters++;
    }
  }
  const uniqueReporters = votes.length;
  const scamRatio = totalWeight === 0 ? 0 : scamWeight / totalWeight;

  let riskLevel: RiskLevel;
  if (uniqueReporters < cfg.minReporters) {
    riskLevel = 'insufficient';
  } else if (
    score >= cfg.scoreHigh &&
    scamRatio >= cfg.ratioHigh &&
    establishedScamReporters >= cfg.highMinScamReporters
  ) {
    riskLevel = 'high';
  } else if (score >= cfg.scoreMedium && scamRatio >= cfg.ratioMedium) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }
  if (underReview && riskLevel === 'high') riskLevel = 'medium';

  return { score, uniqueReporters, uniqueScamReporters, establishedScamReporters, scamRatio, riskLevel };
}
