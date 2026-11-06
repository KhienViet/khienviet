// Secret không nằm trong wrangler.toml nên `wrangler types` không sinh ra.
// Khai báo cho cả Env toàn cục và Cloudflare.Env (cloudflare:test dùng Cloudflare.Env).
interface Env {
  /** HMAC key để băm install token. `wrangler secret put PEPPER`. */
  PEPPER: string;
}
declare namespace Cloudflare {
  interface Env {
    PEPPER: string;
  }
}
