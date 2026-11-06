import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Bản Kotlin của packages/phone. Module JVM thuần để test chạy nhanh, không cần emulator.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
    testImplementation(libs.kotlinx.serialization.json)
}

tasks.test {
    useJUnitPlatform()
    // Bộ test dùng chung với bản TS: bản TS là chuẩn.
    systemProperty(
        "khienviet.vectors",
        rootProject.file("../../packages/phone/test/vectors.json").absolutePath,
    )
    inputs.file(rootProject.file("../../packages/phone/test/vectors.json"))
}
