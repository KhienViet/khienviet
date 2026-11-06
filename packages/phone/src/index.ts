// Chuẩn hóa số điện thoại sang E.164. Bản TS là chuẩn; bản Kotlin/Swift phải
// chạy cùng bộ test trong test/vectors.json.
//
// Kiểm tra số Việt Nam theo chữ số đầu và độ dài, KHÔNG theo danh sách đầu số
// của từng nhà mạng: danh sách đó thay đổi theo thời gian, và từ chối nhầm một
// số thật (ví dụ đầu số mới) thì người dùng không thể báo cáo số đó.
//   - Di động: số quốc gia (NSN) 9 chữ số, bắt đầu bằng 3, 5, 7, 8, 9.
//   - Cố định: NSN 10 chữ số, bắt đầu bằng 2.

export type PhoneKind = 'mobile' | 'landline' | 'foreign';

export interface NormalizedPhone {
  /** Dạng E.164, ví dụ `+84912345678`. */
  e164: string;
  kind: PhoneKind;
  isForeign: boolean;
}

const VN_CC = '84';
const VN_MOBILE = /^[35789]\d{8}$/;
const VN_LANDLINE = /^2\d{9}$/;
// E.164: tối đa 15 chữ số. Đặt tối thiểu 8 để loại bớt rác.
const FOREIGN = /^[1-9]\d{7,14}$/;

function classifyVn(nsn: string): NormalizedPhone | null {
  if (VN_MOBILE.test(nsn)) return { e164: `+${VN_CC}${nsn}`, kind: 'mobile', isForeign: false };
  if (VN_LANDLINE.test(nsn)) return { e164: `+${VN_CC}${nsn}`, kind: 'landline', isForeign: false };
  return null;
}

/**
 * Chuẩn hóa chuỗi người dùng nhập. Trả `null` nếu không hợp lệ.
 * Chấp nhận khoảng trắng, dấu chấm, gạch, ngoặc; tiền tố `+`, `00`, `84`, `0`.
 */
export function normalizePhone(input: string): NormalizedPhone | null {
  const trimmed = input.trim();
  if (trimmed === '' || !/^[+\d\s().\-]+$/.test(trimmed)) return null;
  // `+` chỉ được ở đầu.
  if (trimmed.indexOf('+') > 0) return null;

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  let international = hasPlus;
  if (!hasPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }

  if (international) {
    if (digits.startsWith(VN_CC)) {
      let nsn = digits.slice(VN_CC.length);
      // Người dùng hay viết thừa số 0: +84 0912 345 678.
      if (nsn.startsWith('0')) nsn = nsn.slice(1);
      return classifyVn(nsn);
    }
    return FOREIGN.test(digits) ? { e164: `+${digits}`, kind: 'foreign', isForeign: true } : null;
  }

  // Không có tiền tố quốc tế: coi là số Việt Nam.
  if (digits.startsWith('0')) return classifyVn(digits.slice(1));
  // `84` + NSN (11 hoặc 12 chữ số). Phân biệt với NSN 9 chữ số bắt đầu bằng 84 nhờ độ dài.
  if (digits.startsWith(VN_CC) && (digits.length === 11 || digits.length === 12)) {
    return classifyVn(digits.slice(VN_CC.length));
  }
  // Thiếu số 0 đầu: 912345678.
  return classifyVn(digits);
}

/**
 * Che số cho danh sách công khai: `+84912345678` → `+84 91x xxx 678`.
 * Giữ 2 chữ số đầu và 3 chữ số cuối của phần sau mã quốc gia.
 * Đầu vào phải là E.164 đã chuẩn hóa.
 */
export function maskPhone(e164: string): string {
  if (!/^\+\d{8,15}$/.test(e164)) throw new Error('maskPhone expects normalized E.164');
  const isVn = e164.startsWith(`+${VN_CC}`);
  // Số nước ngoài: không biết độ dài mã quốc gia, chỉ giữ `+` và 2 chữ số đầu.
  const cc = isVn ? VN_CC : '';
  const rest = e164.slice(1 + cc.length);
  const head = rest.slice(0, 2);
  const tail = rest.slice(-3);
  const hidden = 'x'.repeat(rest.length - head.length - tail.length);
  // Nhóm phần ẩn: chữ x đầu dính với head, phần còn lại thành một nhóm.
  const masked = `${head}${hidden.slice(0, 1)} ${hidden.slice(1)} ${tail}`;
  return isVn ? `+${cc} ${masked}` : `+${masked}`;
}
