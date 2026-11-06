import { describe, expect, it } from 'vitest';
import { configFromEnv, scoreVotes, type Vote } from '../src/scoring';

const ENV = {
  SCORE_HALF_LIFE_DAYS: '30',
  SCORE_MIN_REPORTERS: '3',
  SCORE_MEDIUM: '1.5',
  SCORE_HIGH: '4',
  HIGH_MIN_REPORTERS: '5',
  WARMUP_DAYS: '3',
  WARMUP_WEIGHT: '0.5',
};
const cfg = configFromEnv(ENV);
const NOW = 1_800_000_000;
const DAY = 86_400;
// accountAgeDays: tuổi tài khoản tính đến NOW. Mặc định 1 năm (đã qua thời gian làm quen).
const votes = (n: number, ageDays = 0, trust = 1, accountAgeDays = 365): Vote[] =>
  Array.from({ length: n }, () => ({
    createdAt: NOW - ageDays * DAY,
    trust,
    reporterCreatedAt: NOW - Math.max(ageDays, accountAgeDays) * DAY,
  }));

describe('scoreVotes', () => {
  it('below the reporter threshold is insufficient, however strong the votes', () => {
    const r = scoreVotes(votes(2, 0, 3), NOW, false, cfg);
    expect(r.score).toBe(6);
    expect(r.riskLevel).toBe('insufficient');
  });

  it('no votes is insufficient with zero score', () => {
    expect(scoreVotes([], NOW, false, cfg)).toMatchObject({ riskLevel: 'insufficient', score: 0, uniqueReporters: 0 });
  });

  it('medium from 3 reporters, high needs score 4 and 5 established reporters', () => {
    expect(scoreVotes(votes(3), NOW, false, cfg).riskLevel).toBe('medium');
    expect(scoreVotes(votes(5), NOW, false, cfg).riskLevel).toBe('high');
    // 4 người báo trust 3.0: điểm 12 nhưng chưa đủ 5 người → chỉ medium.
    expect(scoreVotes(votes(4, 0, 3), NOW, false, cfg).riskLevel).toBe('medium');
  });

  it('3 brand-new accounts score exactly 1.5, which is medium', () => {
    const r = scoreVotes(votes(3, 0, 1, 0), NOW, false, cfg);
    expect(r.score).toBe(1.5);
    expect(r.riskLevel).toBe('medium');
  });

  it('low when the score falls below 1.5 with enough reporters', () => {
    // 3 người trust 0.4: điểm 1.2 → low.
    expect(scoreVotes(votes(3, 0, 0.4), NOW, false, cfg).riskLevel).toBe('low');
  });

  it('time decay halves weight every 30 days', () => {
    expect(scoreVotes(votes(1, 30), NOW, false, cfg).score).toBeCloseTo(0.5, 10);
    expect(scoreVotes(votes(1, 60), NOW, false, cfg).score).toBeCloseTo(0.25, 10);
    // 6 người báo cách đây 90 ngày: 6 × 0.125 = 0.75 → từ high xuống low.
    expect(scoreVotes(votes(6), NOW, false, cfg).riskLevel).toBe('high');
    expect(scoreVotes(votes(6, 90), NOW, false, cfg).riskLevel).toBe('low');
  });

  it('a vote dated in the future (clock skew) counts as fresh, not heavier', () => {
    const r = scoreVotes([{ createdAt: NOW + 10 * DAY, trust: 1, reporterCreatedAt: NOW - 365 * DAY }], NOW, false, cfg);
    expect(r.score).toBe(1);
  });

  it('under review caps high at medium', () => {
    expect(scoreVotes(votes(8), NOW, true, cfg).riskLevel).toBe('medium');
    expect(scoreVotes(votes(2), NOW, true, cfg).riskLevel).toBe('insufficient');
  });

  it('low-trust accounts barely move the score', () => {
    // 20 tài khoản bị hạ trust 0.1: điểm 2 → chỉ medium, không thể lên high.
    const r = scoreVotes(votes(20, 0, 0.1), NOW, false, cfg);
    expect(r.score).toBeCloseTo(2, 10);
    expect(r.riskLevel).toBe('medium');
  });

  describe('warm-up period for new accounts', () => {
    it('votes from accounts younger than 3 days count half', () => {
      expect(scoreVotes(votes(1, 0, 1, 1), NOW, false, cfg).score).toBeCloseTo(0.5, 10);
      expect(scoreVotes(votes(1, 0, 1, 3), NOW, false, cfg).score).toBeCloseTo(1, 10);
    });

    it('a vote cast on install day gains full weight once the account is 3 days old', () => {
      // Người dùng thật thường cài app rồi báo ngay. Phiếu đó không bị giảm mãi.
      const v: Vote = { createdAt: NOW, trust: 1, reporterCreatedAt: NOW };
      expect(scoreVotes([v], NOW + DAY, false, cfg).score).toBeCloseTo(0.5 * Math.pow(0.5, 1 / 30), 10);
      expect(scoreVotes([v], NOW + 3 * DAY, false, cfg).score).toBeCloseTo(Math.pow(0.5, 3 / 30), 10);
    });

    it('new accounts alone cannot reach high, however many', () => {
      // 20 tài khoản mới: điểm 10, nhưng 0 người đã qua làm quen → medium.
      const r = scoreVotes(votes(20, 0, 1, 0), NOW, false, cfg);
      expect(r.score).toBeCloseTo(10, 10);
      expect(r.uniqueReporters).toBe(20);
      expect(r.establishedReporters).toBe(0);
      expect(r.riskLevel).toBe('medium');
    });

    it('high needs 5 established reporters; new ones add to the score', () => {
      expect(scoreVotes([...votes(4), ...votes(3, 0, 1, 0)], NOW, false, cfg).riskLevel).toBe('medium');
      expect(scoreVotes([...votes(5), ...votes(3, 0, 1, 0)], NOW, false, cfg).riskLevel).toBe('high');
    });
  });
});

describe('configFromEnv', () => {
  it('fails loudly on a missing or invalid threshold', () => {
    expect(() => configFromEnv({ ...ENV, SCORE_HIGH: '' })).toThrow(/SCORE_HIGH/);
    expect(() => configFromEnv({ ...ENV, HIGH_MIN_REPORTERS: 'abc' })).toThrow(/HIGH_MIN_REPORTERS/);
    expect(() => configFromEnv({ ...ENV, SCORE_MEDIUM: '-1' })).toThrow(/SCORE_MEDIUM/);
    expect(() => configFromEnv({ ...ENV, WARMUP_WEIGHT: '1.5' })).toThrow(/WARMUP_WEIGHT/);
    expect(() => configFromEnv({ ...ENV, WARMUP_DAYS: '' })).toThrow(/WARMUP_DAYS/);
  });
});
