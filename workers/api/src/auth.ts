// Install token ẩn danh cho app. Token chỉ trả về một lần khi đăng ký; D1 chỉ lưu
// HMAC-SHA256(PEPPER, token). Không lưu IP, thông tin thiết bị hay số điện thoại.

const MIN_PEPPER_LENGTH = 32;

function requirePepper(env: Env): string {
  const pepper = env.PEPPER;
  if (typeof pepper !== 'string' || pepper.length < MIN_PEPPER_LENGTH) {
    // Thiếu secret thì dừng hẳn, không băm với giá trị rỗng.
    throw new Error('PEPPER secret missing or too short');
  }
  return pepper;
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashToken(env: Env, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requirePepper(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Reporter {
  id: string;
  banned: number;
}

/** Đọc `Authorization: Bearer <token>`. Trả reporter hoặc null. */
export async function findReporter(env: Env, authorization: string | undefined): Promise<Reporter | null> {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
  if (!m) return null;
  const hash = await hashToken(env, m[1]!);
  return env.DB.prepare(`SELECT id, banned FROM reporters WHERE token_hash = ?1`).bind(hash).first<Reporter>();
}
