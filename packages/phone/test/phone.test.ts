import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone } from '../src/index';
import vectors from './vectors.json';

describe('normalizePhone', () => {
  for (const v of vectors.normalize) {
    it(`${JSON.stringify(v.input)} → ${v.expected ? v.expected.e164 : 'null'}`, () => {
      const r = normalizePhone(v.input);
      if (v.expected === null) {
        expect(r).toBeNull();
      } else {
        expect(r).toEqual({
          e164: v.expected.e164,
          kind: v.expected.kind,
          isForeign: v.expected.kind === 'foreign',
        });
      }
    });
  }

  it('is idempotent on its own output', () => {
    for (const v of vectors.normalize) {
      if (v.expected) expect(normalizePhone(v.expected.e164)?.e164).toBe(v.expected.e164);
    }
  });
});

describe('maskPhone', () => {
  for (const v of vectors.mask) {
    it(`${v.input} → ${v.expected}`, () => {
      expect(maskPhone(v.input)).toBe(v.expected);
    });
  }

  it('never leaks the middle digits', () => {
    const masked = maskPhone('+84912345678');
    expect(masked).not.toMatch(/2345/);
  });

  it('rejects non-normalized input', () => {
    expect(() => maskPhone('0912345678')).toThrow();
  });
});
