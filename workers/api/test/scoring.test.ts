import { describe, expect, it } from 'vitest';
import { configFromEnv, scoreVotes, type Label, type Vote } from '../src/scoring';

const cfg = configFromEnv({
  SCORE_HALF_LIFE_DAYS: '30',
  SCORE_MIN_REPORTERS: '3',
  SCORE_MEDIUM: '1.5',
  SCORE_HIGH: '4',
  RATIO_MEDIUM: '0.3',
  RATIO_HIGH: '0.7',
  HIGH_MIN_SCAM_REPORTERS: '5',
  WARMUP_DAYS: '3',
  WARMUP_WEIGHT: '0.5',
});
const NOW = 1_800_000_000;
const DAY = 86_400;
// accountAgeDays: tuổi tài khoản tính đến NOW. Mặc định 1 năm (đã qua thời gian làm quen).
const votes = (n: number, label: Label, ageDays = 0, trust = 1, accountAgeDays = 365): Vote[] =>
  Array.from({ length: n }, () => ({
    label,
    createdAt: NOW - ageDays * DAY,
    trust,
    reporterCreatedAt: NOW - Math.max(ageDays, accountAgeDays) * DAY,
  }));

describe('scoreVotes', () => {
  it('below the reporter threshold is insufficient, however strong the votes', () => {
    const r = scoreVotes(votes(2, 'scam', 0, 3), NOW, false, cfg);
    expect(r.score).toBe(6);
    expect(r.riskLevel).toBe('insufficient');
  });

  it('no votes is insufficient with zero ratio', () => {
    expect(scoreVotes([], NOW, false, cfg)).toMatchObject({ riskLevel: 'insufficient', scamRatio: 0, score: 0 });
  });

  it('high needs score, ratio and at least 5 unique scam reporters', () => {
    expect(scoreVotes(votes(5, 'scam'), NOW, false, cfg).riskLevel).toBe('high');
    // 4 người báo trust 3.0: điểm 12, tỷ lệ 1.0 nhưng chưa đủ 5 người → chỉ medium.
    expect(scoreVotes(votes(4, 'scam', 0, 3), NOW, false, cfg).riskLevel).toBe('medium');
  });

  it('medium and low boundaries', () => {
    // 2 scam + 1 unknown: score 2, ratio 0.67 → medium
    expect(scoreVotes([...votes(2, 'scam'), ...votes(1, 'unknown')], NOW, false, cfg).riskLevel).toBe('medium');
    // 1 scam + 2 unknown: score 1 < 1.5 → low
    expect(scoreVotes([...votes(1, 'scam'), ...votes(2, 'unknown')], NOW, false, cfg).riskLevel).toBe('low');
    // spam alone: 10 × 0.3 = 3 điểm nhưng tỷ lệ scam 0 → low
    expect(scoreVotes(votes(10, 'spam'), NOW, false, cfg).riskLevel).toBe('low');
  });

  it('time decay halves weight every 30 days', () => {
    expect(scoreVotes(votes(1, 'scam', 30), NOW, false, cfg).score).toBeCloseTo(0.5, 10);
    expect(scoreVotes(votes(1, 'scam', 60), NOW, false, cfg).score).toBeCloseTo(0.25, 10);
    // 6 người báo cách đây 90 ngày: 6 × 0.125 = 0.75 → từ high xuống low.
    expect(scoreVotes(votes(6, 'scam'), NOW, false, cfg).riskLevel).toBe('high');
    expect(scoreVotes(votes(6, 'scam', 90), NOW, false, cfg).riskLevel).toBe('low');
  });

  it('a vote dated in the future (clock skew) counts as fresh, not heavier', () => {
    const r = scoreVotes([{ label: 'scam', createdAt: NOW + 10 * DAY, trust: 1, reporterCreatedAt: NOW - 365 * DAY }], NOW, false, cfg);
    expect(r.score).toBe(1);
  });

  it('under review caps high at medium', () => {
    expect(scoreVotes(votes(8, 'scam'), NOW, true, cfg).riskLevel).toBe('medium');
    expect(scoreVotes(votes(2, 'scam'), NOW, true, cfg).riskLevel).toBe('insufficient');
  });

  describe('spamming the `safe` label', () => {
    it('equally trusted safe votes outweigh scam votes (mitigated by anomaly detection, not the formula)', () => {
      const r = scoreVotes([...votes(6, 'scam'), ...votes(7, 'safe')], NOW, false, cfg);
      expect(r.score).toBe(-1);
      expect(r.riskLevel).toBe('low');
    });

    it('low-trust safe votes barely move the score ...', () => {
      const r = scoreVotes([...votes(6, 'scam'), ...votes(20, 'safe', 0, 0.1)], NOW, false, cfg);
      expect(r.score).toBeCloseTo(4, 10);
    });

    it('... and no longer drop scam_ratio, which is weighted the same way as the score', () => {
      // 6 người báo lừa đảo (trust 1.0) + 20 tài khoản bị hạ trust 0.1 báo "an toàn".
      // Tỷ lệ theo người sẽ là 6/26 = 0.23 → low. Theo trọng số: 6 / (6 + 20 × 0.1) = 0.75 → high.
      const r = scoreVotes([...votes(6, 'scam'), ...votes(20, 'safe', 0, 0.1)], NOW, false, cfg);
      expect(r.scamRatio).toBeCloseTo(0.75, 10);
      expect(r.riskLevel).toBe('high');
    });
  });

  it('scam_ratio is time-weighted: old votes count less in the ratio too', () => {
    // 5 scam mới + 5 safe cách đây 90 ngày (trọng số 0.125): 5 / (5 + 0.625)
    const r = scoreVotes([...votes(5, 'scam'), ...votes(5, 'safe', 90)], NOW, false, cfg);
    expect(r.scamRatio).toBeCloseTo(5 / 5.625, 10);
  });

  describe('warm-up period for new accounts', () => {
    it('votes from accounts younger than 3 days count half', () => {
      expect(scoreVotes(votes(1, 'scam', 0, 1, 1), NOW, false, cfg).score).toBeCloseTo(0.5, 10);
      expect(scoreVotes(votes(1, 'scam', 0, 1, 3), NOW, false, cfg).score).toBeCloseTo(1, 10);
    });

    it('a vote cast on install day gains full weight once the account is 3 days old', () => {
      // Người dùng thật thường cài app rồi báo ngay. Phiếu đó không bị giảm mãi.
      const v: Vote = { label: 'scam', createdAt: NOW, trust: 1, reporterCreatedAt: NOW };
      expect(scoreVotes([v], NOW + DAY, false, cfg).score).toBeCloseTo(0.5 * Math.pow(0.5, 1 / 30), 10);
      expect(scoreVotes([v], NOW + 3 * DAY, false, cfg).score).toBeCloseTo(Math.pow(0.5, 3 / 30), 10);
    });

    it('new accounts alone cannot reach high, however many', () => {
      // 20 tài khoản mới: score 10, tỷ lệ 1.0, nhưng 0 người báo đã qua làm quen → medium.
      const r = scoreVotes(votes(20, 'scam', 0, 1, 0), NOW, false, cfg);
      expect(r.score).toBeCloseTo(10, 10);
      expect(r.uniqueScamReporters).toBe(20);
      expect(r.establishedScamReporters).toBe(0);
      expect(r.riskLevel).toBe('medium');
    });

    it('high needs 5 established scam reporters; new ones add to the score', () => {
      const four = [...votes(4, 'scam'), ...votes(3, 'scam', 0, 1, 0)];
      expect(scoreVotes(four, NOW, false, cfg).riskLevel).toBe('medium');
      const five = [...votes(5, 'scam'), ...votes(3, 'scam', 0, 1, 0)];
      expect(scoreVotes(five, NOW, false, cfg).riskLevel).toBe('high');
    });

    it('new accounts flooding `safe` move the ratio only at half weight', () => {
      // 6 scam + 9 safe mới: 6 / (6 + 4.5) = 0.57 ≥ 0.3, score 1.5 → medium (không về low).
      const r = scoreVotes([...votes(6, 'scam'), ...votes(9, 'safe', 0, 1, 0)], NOW, false, cfg);
      expect(r.riskLevel).toBe('medium');
    });
  });
});

describe('configFromEnv', () => {
  it('fails loudly on a missing or invalid threshold', () => {
    const base = {
      SCORE_HALF_LIFE_DAYS: '30',
      SCORE_MIN_REPORTERS: '3',
      SCORE_MEDIUM: '1.5',
      SCORE_HIGH: '4',
      RATIO_MEDIUM: '0.3',
      RATIO_HIGH: '0.7',
      HIGH_MIN_SCAM_REPORTERS: '5',
      WARMUP_DAYS: '3',
      WARMUP_WEIGHT: '0.5',
    };
    expect(() => configFromEnv({ ...base, SCORE_HIGH: '' })).toThrow(/SCORE_HIGH/);
    expect(() => configFromEnv({ ...base, RATIO_HIGH: 'abc' })).toThrow(/RATIO_HIGH/);
    expect(() => configFromEnv({ ...base, SCORE_MEDIUM: '-1' })).toThrow(/SCORE_MEDIUM/);
    expect(() => configFromEnv({ ...base, WARMUP_WEIGHT: '1.5' })).toThrow(/WARMUP_WEIGHT/);
    expect(() => configFromEnv({ ...base, WARMUP_DAYS: '' })).toThrow(/WARMUP_DAYS/);
  });
});
