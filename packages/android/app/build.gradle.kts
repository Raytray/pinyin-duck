import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    jacoco
}

jacoco {
    toolVersion = "0.8.13"
}

/**
 * Instruction and branch coverage floor, enforced per class on the portable half of the app.
 *
 * The report covers everything, including the Android framework and Compose surfaces, because
 * the number should be honest. The *gate* deliberately covers only the classes that a plain
 * JVM test can reach: the pinyin parser, the B+ tree reader, the ranking rules and the
 * composition state machine. Those are where behaviour that can actually go wrong lives, and
 * they are all testable without a device. Gating the rest too would mean either writing
 * instrumentation tests or setting a floor so low it means nothing.
 */
val COVERAGE_FLOOR = "0.85"

/** The classes the coverage floor is enforced on. */
val GATED_CLASSES = listOf(
    "dev.pinyinduck.android.engine.PinyinKt",
    "dev.pinyinduck.android.engine.PinyinDuckEngine",
    "dev.pinyinduck.android.engine.PinyinDuckEngineKt",
    "dev.pinyinduck.android.engine.BTreeDictionary*",
    "dev.pinyinduck.android.engine.BTreeCodecKt",
    "dev.pinyinduck.android.engine.ByteReader",
    "dev.pinyinduck.android.engine.RankingKt",
    "dev.pinyinduck.android.engine.MappedPageSource",
    "dev.pinyinduck.android.ime.PinyinDuckSession",
    "dev.pinyinduck.android.ui.KeysKt",
)

/**
 * The dictionary is generated once by `packages/core` and already committed at
 * `packages/web/public/dictionary.btree`. The web app and this keyboard read that same
 * file, so it is copied into the APK instead of being duplicated in the repository.
 */
val syncDictionaryAsset by tasks.registering(Copy::class) {
    description = "Copies the shared generated dictionary.btree into the app assets."
    val source = rootProject.file("../web/public/dictionary.btree")
    onlyIf {
        if (!source.isFile) {
            throw GradleException(
                "Missing ${source.absolutePath}. Run \"npm run build:dict\" at the repository " +
                    "root to generate it before building the Android app."
            )
        }
        true
    }
    from(source)
    into(layout.buildDirectory.dir("generated/dictionaryAssets"))
}

android {
    namespace = "dev.pinyinduck.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.pinyinduck.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(layout.buildDirectory.dir("generated/dictionaryAssets"))
        }
    }

    androidResources {
        // The keyboard mmaps `dictionary.btree` straight out of the APK, which is only
        // possible when the asset is stored uncompressed. Compressing it would also
        // shrink the APK by ~5MB, but `AssetFileDescriptor.openFd` throws on a
        // compressed entry and the dictionary would have to be read into the heap,
        // which is exactly what the paged format exists to avoid.
        noCompress += "btree"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/*.version")
    }

    testOptions {
        unitTests.all {
            it.useJUnit()
            // Unit tests read the real 9.1MB asset so ranking is verified against the
            // same corpus the web app serves, rather than a hand-written fixture.
            it.systemProperty(
                "pinyinduck.dictionary",
                rootProject.file("../web/public/dictionary.btree").absolutePath
            )

            it.extensions.configure<JacocoTaskExtension> {
                // Kotlin data classes generate equals, hashCode, toString and componentN
                // for every property, none of which carry behaviour worth asserting on and
                // all of which would otherwise be reported as uncovered.
                isIncludeNoLocationClasses = true
                excludes = listOf(
                    "jdk.internal.*",
                    "dev.pinyinduck.android.engine.Candidate",
                    "dev.pinyinduck.android.engine.SearchResult",
                    "dev.pinyinduck.android.engine.SearchOptions",
                    "dev.pinyinduck.android.engine.ScoredEntry",
                    "dev.pinyinduck.android.engine.StoredEntry",
                    "dev.pinyinduck.android.engine.ScrollableEntry",
                    "dev.pinyinduck.android.ime.KeyboardUiState",
                    "dev.pinyinduck.android.ui.KeySpec",
                    "dev.pinyinduck.android.ui.KeyboardCallbacks",
                )
            }
        }
    }
}

/**
 * Where the debug variant's compiled classes land.
 *
 * AGP's unit tests are per-variant (`testDebugUnitTest`), so the Jacoco plugin never creates
 * a report task for them the way it does for a plain JVM `test` task. Both the report and
 * the verification below are registered by hand against those classes.
 */
val debugMainClasses by lazy {
    files(
        layout.buildDirectory.dir("tmp/kotlin-classes/debug"),
        layout.buildDirectory.dir("intermediates/javac/debug/classes"),
    )
}

/** HTML and XML coverage for the Android-free half of the app. */
val jacocoTestReport by tasks.registering(JacocoReport::class) {
    group = "coverage"
    description = "Generates the Jacoco coverage report for the unit-tested packages."
    dependsOn(tasks.named("testDebugUnitTest"))

    executionData(files(layout.buildDirectory.file("jacoco/testDebugUnitTest.exec")))
    classDirectories.setFrom(debugMainClasses)
    sourceDirectories.setFrom(files("src/main/java"))

    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

/**
 * Fails the build when instruction coverage drops below the floor.
 *
 * Enforced rather than merely reported, matching how `packages/core` treats its Vitest
 * thresholds: a coverage number nobody fails on is a number that quietly rots.
 */
val jacocoTestCoverageVerification by tasks.registering(JacocoCoverageVerification::class) {
    group = "verification"
    description = "Verifies the unit-tested packages stay above the instruction coverage floor."
    dependsOn(tasks.named("testDebugUnitTest"))

    executionData(files(layout.buildDirectory.file("jacoco/testDebugUnitTest.exec")))
    classDirectories.setFrom(debugMainClasses)
    sourceDirectories.setFrom(files("src/main/java"))

    violationRules {
        // `counter` is what JaCoCo measures, `value` is which form of that measurement is
        // checked, and `minimum` is the line it has to clear. Applied per class so a drop
        // anywhere in the portable half fails, rather than being diluted by the Android
        // surfaces the gate does not cover.
        for (counter in listOf("INSTRUCTION", "BRANCH")) {
            rule {
                limit {
                    this.counter = counter
                    value = "COVEREDRATIO"
                    minimum = BigDecimal(COVERAGE_FLOOR)
                }
                element = "CLASS"
                includes = GATED_CLASSES
            }
        }
    }
}

tasks.named("check") {
    // The report is a dependency of `check`, not just of its own task, so `./gradlew check`
    // always leaves an up-to-date HTML report next to the verdict. Coverage that only
    // appears when someone remembers the right task name is coverage nobody reads.
    dependsOn(jacocoTestReport, jacocoTestCoverageVerification)
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

tasks.named("preBuild").configure { dependsOn(syncDictionaryAsset) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.savedstate.ktx)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
}
