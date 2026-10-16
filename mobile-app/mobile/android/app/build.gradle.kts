import java.util.Properties

plugins {
    id("com.android.application")
    // gradle.properties explicitly opts out of AGP 9 built-in Kotlin.
    id("org.jetbrains.kotlin.android")
    // Flutter must follow the Android and Kotlin plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

// Release variant tasks must fail before packaging if signing is absent/incomplete.
// Debug validation remains possible without private release credentials.
val validateReleaseSigning by tasks.registering {
    doLast {
        val required = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
        if (required.any { keystoreProperties.getProperty(it).isNullOrBlank() }) {
            throw GradleException("Release signing requires complete private android/key.properties; unsigned/debug fallback is forbidden.")
        }
        val store = file(keystoreProperties.getProperty("storeFile"))
        if (!store.isFile || !store.canRead()) {
            throw GradleException("Release keystore is missing or unreadable.")
        }
    }
}
tasks.configureEach {
    if (name == "preReleaseBuild") dependsOn(validateReleaseSigning)
}

android {
    namespace = "com.example.lifestyle_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.lifestyle.app"
        manifestPlaceholders["appLabel"] = "LifeStyle"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        multiDexEnabled = true
    }

    signingConfigs {
        create("release") {
            val keyFileName = keystoreProperties.getProperty("storeFile")
            storeFile = keyFileName?.takeIf { it.isNotBlank() }?.let { file(it) }
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }

    buildTypes {
        debug {
            // Install beside an existing signed app; never require deleting user data.
            applicationIdSuffix = ".validation"
            versionNameSuffix = "-validation"
            manifestPlaceholders["appLabel"] = "LifeStyle Validation"
        }
        release {
            // No debug signing identity and no intentional unsigned release path.
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
