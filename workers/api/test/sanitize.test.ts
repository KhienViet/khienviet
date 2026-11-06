import { describe, expect, it } from 'vitest';
import { NOTE_MAX_LENGTH, sanitizeNote } from '../src/sanitize';

const R = '[đã ẩn]';

describe('sanitizeNote', () => {
  it.each([
    ['gọi lại số 0912 345 678 nhé', `gọi lại số ${R} nhé`],
    ['số +84 912.345.678', `số ${R}`],
    ['0912-345-678', R],
    ['0912  345   678', R], // nhiều dấu cách
    ['0912​345​678', R], // ký tự vô hình chen giữa
    ['0 9 1 2 3 4 5 6 7 8', R],
    ['chuyển vào STK 1903 6789 1234 56 Techcombank', `chuyển vào STK ${R} Techcombank`],
    ['mail tôi a.b+c@example.com', `mail tôi ${R}`],
    ['chuyển 5000000 cho họ', `chuyển ${R} cho họ`], // không có đơn vị tiền: thà xóa nhầm
  ])('redacts %j', (input, expected) => {
    expect(sanitizeNote(input)).toBe(expected);
  });

  it.each([
    'yêu cầu chuyển 5.000.000đ để nhận quà',
    'đòi 50.000.000 đồng phí hồ sơ',
    'phí 2,500,000 VND',
    'mã OTP 1234',
    'gọi lúc 10 giờ, năm 2026',
    'Giả danh công an, dọa khóa tài khoản',
  ])('keeps %j', (input) => {
    expect(sanitizeNote(input)).toBe(input);
  });

  it('does not treat a currency-looking word as currency', () => {
    expect(sanitizeNote('số 0912345678 đồngnai')).toBe(`số ${R} đồngnai`);
  });

  it('collapses whitespace and strips control/bidi characters', () => {
    expect(sanitizeNote('  a\n\tb‮ c\u0000 ')).toBe('a b c');
  });

  it('returns null when empty after cleaning', () => {
    expect(sanitizeNote('   \n ')).toBeNull();
    expect(sanitizeNote('​')).toBeNull();
  });

  it(`truncates to ${NOTE_MAX_LENGTH} code points without splitting characters`, () => {
    const out = sanitizeNote('ạ'.repeat(400))!;
    expect(Array.from(out)).toHaveLength(NOTE_MAX_LENGTH);
    expect(sanitizeNote('😀'.repeat(300))).toBe('😀'.repeat(NOTE_MAX_LENGTH));
  });

  it('redacts before truncating, so a number at the cut point cannot leak partially', () => {
    const out = sanitizeNote('a'.repeat(275) + ' 0912345678')!;
    expect(out).not.toMatch(/\d{3,}/);
  });
});
