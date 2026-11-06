// Bản port từ packages/phone/src/index.ts. Bản TS là chuẩn: mọi thay đổi phải
// làm ở bản TS trước, và cả hai bản phải qua packages/phone/test/vectors.json.
// Lý do kiểm tra lỏng (không theo danh sách đầu số): xem docs/ARCHITECTURE.md mục 2.
package net.khienviet.phone

enum class PhoneKind { MOBILE, LANDLINE, FOREIGN }

data class NormalizedPhone(
    /** Dạng E.164, ví dụ `+84912345678`. */
    val e164: String,
    val kind: PhoneKind,
) {
    val isForeign: Boolean get() = kind == PhoneKind.FOREIGN
}

object Phone {
    private const val VN_CC = "84"
    private val VN_MOBILE = Regex("^[35789]\\d{8}$")
    private val VN_LANDLINE = Regex("^2\\d{9}$")
    private val FOREIGN = Regex("^[1-9]\\d{7,14}$")
    // Khớp đúng tập ký tự `\s` của JavaScript (bản TS dùng `\s`). `\s` của Java
    // không gồm khoảng trắng không ngắt (U+00A0), thường có khi dán số từ trang web.
    private const val JS_WHITESPACE =
        "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val ALLOWED = Regex("^[+\\d$JS_WHITESPACE().\\-]+$")
    private val NON_DIGIT = Regex("\\D")
    private val E164 = Regex("^\\+\\d{8,15}$")

    private fun classifyVn(nsn: String): NormalizedPhone? = when {
        VN_MOBILE.matches(nsn) -> NormalizedPhone("+$VN_CC$nsn", PhoneKind.MOBILE)
        VN_LANDLINE.matches(nsn) -> NormalizedPhone("+$VN_CC$nsn", PhoneKind.LANDLINE)
        else -> null
    }

    /** Chuẩn hóa chuỗi người dùng nhập. Trả `null` nếu không hợp lệ. */
    fun normalize(input: String): NormalizedPhone? {
        // trim() của Kotlin cắt cả khoảng trắng Unicode, giống String.prototype.trim().
        val trimmed = input.trim()
        if (trimmed.isEmpty() || !ALLOWED.matches(trimmed)) return null
        if (trimmed.indexOf('+') > 0) return null

        val hasPlus = trimmed.startsWith("+")
        var digits = trimmed.replace(NON_DIGIT, "")

        var international = hasPlus
        if (!hasPlus && digits.startsWith("00")) {
            digits = digits.substring(2)
            international = true
        }

        if (international) {
            if (digits.startsWith(VN_CC)) {
                var nsn = digits.substring(VN_CC.length)
                if (nsn.startsWith("0")) nsn = nsn.substring(1)
                return classifyVn(nsn)
            }
            return if (FOREIGN.matches(digits)) NormalizedPhone("+$digits", PhoneKind.FOREIGN) else null
        }

        if (digits.startsWith("0")) return classifyVn(digits.substring(1))
        if (digits.startsWith(VN_CC) && (digits.length == 11 || digits.length == 12)) {
            return classifyVn(digits.substring(VN_CC.length))
        }
        return classifyVn(digits)
    }

    /** Che số cho danh sách công khai: `+84912345678` → `+84 91x xxx 678`. */
    fun mask(e164: String): String {
        require(E164.matches(e164)) { "mask expects normalized E.164" }
        val isVn = e164.startsWith("+$VN_CC")
        val cc = if (isVn) VN_CC else ""
        val rest = e164.substring(1 + cc.length)
        val head = rest.take(2)
        val tail = rest.takeLast(3)
        val hidden = "x".repeat(rest.length - head.length - tail.length)
        val masked = "$head${hidden.take(1)} ${hidden.drop(1)} $tail"
        return if (isVn) "+$cc $masked" else "+$masked"
    }
}
