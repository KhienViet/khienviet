# CLAUDE.md

Hướng dẫn cho Claude Code khi làm việc trong repo này.

## Dự án

**Khiên Việt** (khienviet.net): nền tảng cộng đồng, phi lợi nhuận, mã nguồn mở, giúp người dùng tại Việt Nam ghi nhận và tra cứu số điện thoại bị báo cáo lừa đảo. Gồm website tra cứu công khai, API trên Cloudflare Workers, app Android và app iOS.

Tài liệu chi tiết:
- `docs/PLAN.md`: mục tiêu, lộ trình, rủi ro.
- `docs/ARCHITECTURE.md`: kiến trúc, schema D1, thuật toán điểm, API. **Đọc file này trước khi sửa schema, API hoặc logic tính điểm.**

## Stack

- **API:** Cloudflare Workers, TypeScript, Hono, D1 (SQLite), KV, Turnstile, Rate Limiting binding, Cron Triggers.
- **Web:** Cloudflare Pages, Astro, CSS thuần hoặc Tailwind. Ưu tiên nhẹ, nhanh, mobile-first.
- **Android:** Kotlin, `CallScreeningService`, Room, WorkManager.
- **iOS:** Swift, Call Directory Extension, App Intents.
- **Chung:** `packages/phone` chứa hàm chuẩn hóa số E.164 (bản TS là chuẩn; bản Kotlin/Swift phải qua cùng bộ test case).

## Lệnh thường dùng

```bash
# API
cd workers/api
npm install
npx wrangler dev                                        # chạy local
npx wrangler d1 migrations create khienviet <tên>       # tạo migration
npx wrangler d1 migrations apply khienviet --local      # áp dụng local
npx wrangler d1 migrations apply khienviet --remote     # áp dụng production (cần xác nhận của người dùng)
npm test                                                # vitest
npx wrangler deploy                                     # deploy (cần xác nhận của người dùng)

# Web
cd apps/web
npm install && npm run dev
npm run build

# Package phone
cd packages/phone && npm test
```

## Quy tắc bắt buộc

### Quyền riêng tư và an toàn
- **Không bao giờ** thu thập hoặc lưu danh bạ, lịch sử cuộc gọi, vị trí hay số điện thoại của người báo cáo.
- **Không lưu IP** vào D1 hay KV. IP chỉ dùng trong bộ nhớ để rate limit.
- Install token phải được hash (SHA-256 + `PEPPER` secret) trước khi lưu.
- Không log số điện thoại của người báo cáo, token, nội dung khiếu nại hay secrets. Được log số bị tra cứu ở dạng đã che.
- Mọi danh sách công khai (top, thống kê) phải **che số** bằng hàm `maskPhone()`: `+84 91x xxx 678`.
- Note của báo cáo phải qua `sanitizeNote()`: loại bỏ số điện thoại, email, số tài khoản; tối đa 280 ký tự.
- Không commit secrets, file `.dev.vars`, dữ liệu thật hay dump D1.
- Không đưa tên thật, email hay số điện thoại của người vận hành vào code, commit, comment hoặc tài liệu.

### Ngôn từ trên giao diện
- Dùng ngôn từ trung lập, mô tả số liệu: "96 người đã báo cáo số này là lừa đảo".
- **Không** viết "Đây là số lừa đảo" hay "Số lừa đảo đã xác nhận".
- Luôn ghi chú rằng số liệu chỉ phản ánh báo cáo của cộng đồng, không phải tổng số cuộc gọi thực tế.
- Số đang có khiếu nại (`under_review`) phải hiển thị trạng thái "Đang xem xét".
- Văn bản giao diện bằng tiếng Việt; đặt trong file i18n (`apps/web/src/i18n/vi.json`), không hardcode.

### Logic tính điểm
- Công thức và ngưỡng nằm trong `workers/api/src/scoring.ts`, các ngưỡng đọc từ biến môi trường.
- Mọi thay đổi công thức phải cập nhật **cả** `docs/ARCHITECTURE.md` mục 4 và trang "Cách tính điểm" trên web, vì công thức được công khai.
- Mỗi reporter chỉ tính phiếu mới nhất của họ cho một số. Không đếm theo lượt báo cáo thô.
- Phải có test cho các trường hợp: dưới ngưỡng người báo, spam nhãn `safe`, giảm trọng số theo thời gian, đang khiếu nại.

### Endpoint ghi
- Mọi endpoint ghi phải kiểm tra Turnstile (web) hoặc install token hợp lệ (app), và áp rate limit.
- Validate đầu vào bằng zod. Số điện thoại phải qua `normalizePhone()`; nếu không hợp lệ thì trả 400.
- Truy vấn D1 luôn dùng prepared statements (`.bind()`), không nối chuỗi SQL.

### Schema
- Thay đổi schema chỉ qua migration mới trong `workers/api/migrations/`. Không sửa migration đã áp dụng.
- Cập nhật mục 3 của `docs/ARCHITECTURE.md` khi đổi schema.

## Quy ước code

- TypeScript `strict`, ESM, không dùng `any` trừ khi có lý do ghi rõ.
- Tên biến, hàm và file bằng tiếng Anh; comment có thể bằng tiếng Việt.
- Response API dạng `{ data }` hoặc `{ error: { code, message } }`, có version `/api/v1/`.
- Thời gian lưu dạng Unix epoch (giây); API trả ISO 8601 UTC.
- Test: vitest với `@cloudflare/vitest-pool-workers` cho Worker. Viết test trước khi sửa logic tính điểm hoặc chuẩn hóa số.
- Commit theo Conventional Commits (`feat:`, `fix:`, `docs:`...).

## Khi không chắc

- Nếu một thay đổi có thể ảnh hưởng đến quyền riêng tư, độ chính xác của nhãn hoặc danh tính người vận hành, hãy dừng lại và hỏi trước.
- Không tự chạy `--remote` migration, `wrangler deploy` hay thao tác xóa dữ liệu production khi chưa được xác nhận.
