# PLAN — Khiên Việt (khienviet.net)

Dự án cộng đồng, phi lợi nhuận, mã nguồn mở. Người dùng ghi nhận các cuộc gọi lạ và gắn nhãn (lừa đảo / làm phiền / an toàn), từ đó cộng đồng biết một số điện thoại đã gọi bao nhiêu cuộc được ghi nhận và bao nhiêu cuộc bị báo lừa đảo.

## 1. Mục tiêu

- Giúp người nhận cuộc gọi lạ tra cứu nhanh mức nguy cơ của số gọi đến.
- Khiến số lừa đảo nhanh chóng mất tác dụng nhờ cảnh báo lan truyền trong cộng đồng.
- Công khai số liệu minh bạch trên website, có thể chia sẻ dữ liệu cho đối tác và cơ quan chức năng.

## 2. Nguyên tắc

1. **Dữ liệu chỉ đến từ báo cáo cộng đồng.** Không đọc lịch sử cuộc gọi, không thu thập danh bạ.
2. **Minh bạch:** công khai mã nguồn (Apache License 2.0) và công thức tính điểm nguy cơ. Dữ liệu báo cáo **không** cấp phép mở; việc sử dụng theo Điều khoản sử dụng và thỏa thuận API với đối tác. Tên và logo được bảo vệ theo `TRADEMARKS.md`.
3. **Ngôn từ trung lập:** "X người đã báo cáo là lừa đảo", không khẳng định "đây là số lừa đảo".
4. **Công bằng:** có quy trình khiếu nại cho chủ thuê bao; báo cáo cũ giảm trọng số theo thời gian.
5. **An toàn cho người vận hành:** dự án đứng tên nhóm, danh tính cá nhân không công khai.
6. **Không quảng cáo, không bán dữ liệu.**

## 3. Lộ trình

### Giai đoạn 0 — Chuẩn bị (tuần 1–2)
- [x] Tạo email riêng cho dự án (Gmail), bật 2FA bằng app hoặc khóa bảo mật, không dùng SMS. Kiểm tra số điện thoại và email khôi phục không phải của cá nhân người vận hành.
- [x] Tạo tài khoản GitHub riêng (`KhienViet`); `git config user.email` của repo dùng địa chỉ noreply của GitHub.
- [ ] Tạo tài khoản Cloudflare riêng.
- [ ] Mua tên miền chính `khienviet.net` qua Cloudflare Registrar (WHOIS được ẩn).
- [ ] Mua thêm `khienviet.org`, `khienviet.com` (và cân nhắc `khien-viet.net`), chuyển hướng 301 về `khienviet.net` để chống giả mạo.
- [ ] Đặt tên trên store: "Khiên Việt – Tra số lừa đảo".
- [ ] Thiết lập Cloudflare Email Routing: `lienhe@khienviet.net` → email dự án.
- [ ] Chọn tên nhóm/dự án để đứng tên công khai.
- [ ] Tư vấn luật sư: dữ liệu cá nhân (NĐ 13/2023, Luật BVDLCN), quy định dịch vụ Internet (NĐ 147/2024), rủi ro bôi nhọ.
- [ ] Soạn Điều khoản sử dụng, Chính sách quyền riêng tư, Quy trình khiếu nại.

> **Thay đổi thứ tự (2026-11):** làm app Android trước. Vì app cần API để chia sẻ báo cáo, và Google Play yêu cầu URL chính sách quyền riêng tư công khai, nên làm song song: `packages/phone` → API tối thiểu → trang web tối thiểu (giới thiệu, chính sách quyền riêng tư, điều khoản, khiếu nại) → app Android. Trang tra cứu đầy đủ làm sau.

### Giai đoạn 1 — Website MVP (tháng 1–2)
- [ ] Trang tra cứu: một ô nhập số, thẻ kết quả (mức nguy cơ, số cuộc ghi nhận, số người báo lừa đảo, kịch bản thường gặp).
- [ ] Form báo cáo, có Turnstile và rate limit.
- [ ] Trang thống kê công khai (số bị che một phần trong danh sách).
- [ ] Trang khiếu nại / yêu cầu xem xét.
- [ ] Trang "Cách tính điểm" công khai công thức.
- [ ] Public API chỉ đọc (tra cứu một số).
- [ ] Seed dữ liệu: các số đã được báo chí hoặc cơ quan chức năng công bố, ghi rõ nguồn.

**Mục tiêu đầu ra:** 1.000 báo cáo và 300 người báo cáo độc lập.

### Giai đoạn 2 — App Android (tháng 3–4)
- [ ] `CallScreeningService`: tra cứu khi có cuộc gọi đến và hiện cảnh báo.
- [ ] Thông báo sau cuộc gọi từ số lạ: "Báo cáo nhanh?" (1 chạm).
- [ ] Đồng bộ danh sách số nguy cơ cao xuống máy để dùng khi offline.
- [ ] Tùy chọn tự động chặn số nguy cơ cao.
- [ ] Bản đầu: `minSdk 29` (Android 10). Lý do: cách để người dùng chọn app làm app sàng lọc cuộc gọi là `RoleManager.ROLE_CALL_SCREENING`, có từ API 29 (đã xác minh trên tài liệu Android). `CallScreeningService` có từ API 24, nhưng trên Android 7–9 **chưa xác minh** app không phải trình gọi điện mặc định có dùng được hay không: cần thử trên emulator API 28 trước khi quyết định.
- [ ] Hỗ trợ Android cũ (Android 7–9, API 24–28) ở chế độ rút gọn: tra cứu và báo cáo thủ công (dán số, chia sẻ số từ app khác), đồng bộ danh sách để tra offline; **không** cảnh báo khi có cuộc gọi đến. Không xin quyền `READ_CALL_LOG`/`READ_PHONE_STATE` để bù, vì trái nguyên tắc không đọc lịch sử cuộc gọi và bị Google Play hạn chế. Trước khi làm: kiểm tra tỷ lệ máy Android 7–9 tại Việt Nam để quyết định có đáng không.
- [ ] Phát hành trên Google Play (chuẩn bị giải trình quyền) và APK trên GitHub Releases.
- [ ] Tài khoản Google Play cá nhân: công khai tên pháp lý, quốc gia và email nhà phát triển; địa chỉ chỉ công khai nếu có kiếm tiền, nên **không** thu tiền ủng hộ qua Google Play billing.
- [ ] Tài khoản cá nhân tạo sau 13/11/2023 phải chạy closed test với tối thiểu 12 người thử, liên tục 14 ngày, trước khi lên production. Chuẩn bị nhóm người thử sớm.
- [ ] Kiểm tra yêu cầu xác minh nhà phát triển cho APK cài ngoài store (Google triển khai theo quốc gia từ 2026) có áp dụng cho Việt Nam chưa.

### Giai đoạn 3 — App iOS (tháng 5–6)
- [ ] Tài khoản Apple cá nhân hiển thị tên pháp lý làm người bán; khai báo "không phải trader" (DSA) vì chỉ phát hành tại Việt Nam, khi đó không công khai email/số điện thoại/địa chỉ. Muốn đứng tên nhóm thì cần tài khoản Organization (pháp nhân + D-U-N-S).
- [ ] Call Directory Extension: nạp danh sách số nguy cơ cao kèm nhãn.
- [ ] Báo cáo qua dán số, Share Extension hoặc Shortcuts.

### Giai đoạn 4 — Mở rộng
- [ ] Open data API (có key) cho ngân hàng, nhà mạng, các dự án chống lừa đảo.
- [ ] Hợp tác chia sẻ dữ liệu với cơ quan chức năng.
- [ ] Thành lập pháp nhân hoặc gia nhập một tổ chức làm bộ mặt công khai.
- [ ] Mở rộng sang báo cáo tin nhắn SMS và tài khoản ngân hàng.

## 4. Chỉ số theo dõi

| Chỉ số | Ý nghĩa |
|---|---|
| Số người báo cáo độc lập / tuần | Sức sống của cộng đồng |
| Tỷ lệ tra cứu có kết quả | Độ phủ dữ liệu |
| Thời gian từ báo cáo đầu tiên đến khi số đạt "Nguy cơ cao" | Tốc độ cảnh báo |
| Số khiếu nại được chấp nhận / tổng số nhãn "Nguy cơ cao" | Độ chính xác (càng thấp càng tốt) |
| Chi phí hạ tầng / tháng | Bền vững tài chính |

## 5. Rủi ro và cách giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Kẻ lừa đảo spam nhãn "an toàn" để làm sạch số | Tính theo người báo độc lập, trọng số uy tín, phát hiện báo cáo dồn dập |
| Báo cáo sai, gây oan cho số hợp pháp | Ngưỡng tối thiểu, ngôn từ trung lập, khiếu nại, giảm trọng số theo thời gian |
| Bị DDoS | Cloudflare proxy, cache edge, rate limit, không có server gốc |
| Người vận hành bị lộ danh tính hoặc bị đe dọa | Tách biệt tài khoản, WHOIS ẩn, đứng tên nhóm, hạn chế người biết |
| Vấn đề pháp lý | Tư vấn luật sư, chính sách rõ ràng, hướng tới vận hành qua tổ chức |
| Thiếu dữ liệu ban đầu (con gà – quả trứng) | Seed dữ liệu công khai, hợp tác các nhóm cảnh báo lừa đảo trên mạng xã hội |
| Hết kinh phí | Kiến trúc serverless chi phí thấp, nhận ủng hộ minh bạch, xin tài trợ |

## 6. Kinh phí dự kiến (giai đoạn đầu)

- Tên miền: khoảng 250–400 nghìn đồng/năm.
- Cloudflare (Pages, Workers, D1, Turnstile): gói miễn phí hoặc Workers Paid khoảng 5 USD/tháng khi lượng truy cập tăng.
- Google Play Developer: 25 USD một lần. Apple Developer: 99 USD/năm (giai đoạn 3).
