// Lọc ghi chú của báo cáo trước khi lưu: bỏ email, số điện thoại, số tài khoản.
// Thà xóa nhầm một con số còn hơn lưu thông tin cá nhân của người khác.

export const NOTE_MAX_LENGTH = 280;
const REDACTED = '[đã ẩn]';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/gu;
// Dãy chữ số, cho phép một dấu cách/chấm/phẩy/gạch giữa các chữ số: "0912 345 678", "1903.6789.1234".
const DIGIT_RUN = /\+?\d(?:[ .,\-]?\d)*/gu;
// Từ 6 chữ số trở lên thì coi là số điện thoại / số tài khoản và xóa ...
const MIN_REDACT_DIGITS = 6;
// ... trừ khi ngay sau là đơn vị tiền ("5.000.000đ", "500.000 đồng"), vì số tiền hữu ích để nhận diện kịch bản.
const CURRENCY_AFTER = /^\s?(?:đ|đồng|vnd|vnđ)(?!\p{L})/iu;
// Ký tự điều khiển (trừ khoảng trắng thông thường), ký tự vô hình và định hướng văn bản.
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

/** Trả ghi chú đã lọc, hoặc `null` nếu rỗng sau khi lọc. */
export function sanitizeNote(raw: string): string | null {
  // Gộp khoảng trắng trước để "0912  345 678" (nhiều dấu cách) vẫn bị nhận ra là một dãy số.
  let s = raw.normalize('NFC').replace(CONTROL, (c) => (/\s/.test(c) ? ' ' : '')).replace(/\s+/g, ' ');
  s = s.replace(EMAIL, REDACTED);
  s = s.replace(DIGIT_RUN, (match: string, offset: number, whole: string) => {
    const digits = match.replace(/\D/g, '').length;
    if (digits < MIN_REDACT_DIGITS) return match;
    if (CURRENCY_AFTER.test(whole.slice(offset + match.length))) return match;
    return REDACTED;
  });
  s = s.replace(/\s+/g, ' ').trim();
  if (s === '') return null;
  // Cắt theo code point để không làm vỡ ký tự.
  const chars = Array.from(s);
  return chars.length > NOTE_MAX_LENGTH ? chars.slice(0, NOTE_MAX_LENGTH).join('').trimEnd() : s;
}
