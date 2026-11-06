package net.khienviet.phone

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.assertThrows
import java.io.File

/** Chạy cùng bộ test với bản TS (packages/phone/test/vectors.json). */
class PhoneVectorsTest {
    private val vectors: JsonObject = run {
        val path = requireNotNull(System.getProperty("khienviet.vectors")) {
            "system property khienviet.vectors not set"
        }
        Json.parseToJsonElement(File(path).readText()).jsonObject
    }

    @TestFactory
    fun normalize(): List<DynamicTest> =
        vectors.getValue("normalize").jsonArray.map { el ->
            val v = el.jsonObject
            val input = v.getValue("input").jsonPrimitive.content
            val expected = v.getValue("expected")
            DynamicTest.dynamicTest("\"$input\"") {
                val r = Phone.normalize(input)
                if (expected is JsonNull) {
                    assertNull(r)
                } else {
                    val e = expected.jsonObject
                    val kind = PhoneKind.valueOf(e.getValue("kind").jsonPrimitive.content.uppercase())
                    assertEquals(NormalizedPhone(e.getValue("e164").jsonPrimitive.content, kind), r)
                    // Idempotent trên chính kết quả.
                    assertEquals(r?.e164, Phone.normalize(r!!.e164)?.e164)
                }
            }
        }

    @TestFactory
    fun mask(): List<DynamicTest> =
        vectors.getValue("mask").jsonArray.map { el ->
            val v = el.jsonObject
            val input = v.getValue("input").jsonPrimitive.content
            DynamicTest.dynamicTest(input) {
                assertEquals(v.getValue("expected").jsonPrimitive.content, Phone.mask(input))
            }
        }

    @Test
    fun maskNeverLeaksMiddleDigits() {
        assertFalse(Phone.mask("+84912345678").contains("2345"))
    }

    @Test
    fun maskRejectsNonNormalized() {
        assertThrows<IllegalArgumentException> { Phone.mask("0912345678") }
    }
}
