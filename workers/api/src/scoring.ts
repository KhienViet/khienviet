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
}

export interface ScoringConfig {
  halfLifeDays: number;
  minReporters: number;
  scoreMedium: number;
  scoreHigh: number;
  ratioMedium: number;
  ratioHigh: number;
  highMinScamReporters: number;
}

export interface ScoreResult {
  score: number;
  uniqueReporters: number;
  uniqueScamReporters: number;
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
>;

/** Đọc ngưỡng từ biến môi trường. Thiếu hoặc sai thì ném lỗi: không tính điểm với ngưỡng đoán. */
export function configFromEnv(env: { [K in keyof ThresholdVars]: string }): ScoringConfig {
  const num = (name: keyof ThresholdVars): number => {
    const v = Number(env[name]);
    if (env[name] === undefined || env[name] === '' || !Number.isFinite(v) || v < 0) {
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
  };
}

/**
 * score      = Σ (0.5^(tuổi_ngày / half_life) × trust × v_label)
 * scam_ratio = unique_scam_reporters / unique_reporters
 * Nếu số đang có khiếu nại (underReview), mức `high` bị hạ xuống `medium`:
 * giao diện hiển thị "Đang xem xét", và app không tự động chặn.
 */
export function scoreVotes(votes: Vote[], now: number, underReview: boolean, cfg: ScoringConfig): ScoreResult {
  let score = 0;
  let uniqueScamReporters = 0;
  for (const v of votes) {
    const ageDays = Math.max(0, now - v.createdAt) / DAY; // phiếu "ở tương lai" (lệch giờ) tính như mới
    const wTime = Math.pow(0.5, ageDays / cfg.halfLifeDays);
    score += wTime * v.trust * LABEL_VALUE[v.label];
    if (v.label === 'scam') uniqueScamReporters++;
  }
  const uniqueReporters = votes.length;
  const scamRatio = uniqueReporters === 0 ? 0 : uniqueScamReporters / uniqueReporters;

  let riskLevel: RiskLevel;
  if (uniqueReporters < cfg.minReporters) {
    riskLevel = 'insufficient';
  } else if (
    score >= cfg.scoreHigh &&
    scamRatio >= cfg.ratioHigh &&
    uniqueScamReporters >= cfg.highMinScamReporters
  ) {
    riskLevel = 'high';
  } else if (score >= cfg.scoreMedium && scamRatio >= cfg.ratioMedium) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }
  if (underReview && riskLevel === 'high') riskLevel = 'medium';

  return { score, uniqueReporters, uniqueScamReporters, scamRatio, riskLevel };
}
