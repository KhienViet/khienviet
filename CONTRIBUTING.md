# Đóng góp

## Cài đặt một lần sau khi clone

```bash
brew install gitleaks            # hoặc xem https://github.com/gitleaks/gitleaks
git config core.hooksPath .githooks
```

Hook `pre-push` chặn push khi commit sắp đẩy lên:
1. có secret (quét bằng gitleaks, kết quả được che);
2. có tác giả hoặc người commit không dùng địa chỉ noreply của GitHub;
3. khớp danh sách thông tin cá nhân riêng của máy bạn trong `.git/push-denylist` (tùy chọn; mỗi dòng một biểu thức chính quy, ví dụ tên thật, email cá nhân, đường dẫn thư mục home của bạn). File này nằm trong `.git/` nên không bao giờ bị commit. **Đừng** đưa các mẫu này vào file được commit, vì như vậy chính là làm lộ thông tin.

Chỉ dùng `git push --no-verify` khi chắc chắn cảnh báo là nhầm.

## Quy tắc

- Mã nguồn được cấp phép theo [Apache License 2.0](LICENSE). Khi gửi đóng góp, bạn đồng ý cấp phép phần đóng góp theo cùng giấy phép.
- Mỗi commit cần dòng `Signed-off-by` theo [Developer Certificate of Origin](https://developercertificate.org/) (`git commit -s`). Bạn có thể dùng địa chỉ noreply của GitHub thay cho email cá nhân.
- Commit theo Conventional Commits (`feat:`, `fix:`, `docs:`...).
- Không đưa số điện thoại thật, dữ liệu báo cáo thật hay thông tin cá nhân vào code, issue, ảnh chụp màn hình.
- Đọc `CLAUDE.md` (quy tắc bắt buộc) và `docs/ARCHITECTURE.md` trước khi sửa schema, API hoặc logic tính điểm.
