plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "com.mojang.fastbuildmonitor"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        clion("2024.2.5")
        pluginVerifier()
    }
}

intellijPlatform {
    instrumentCode = false
    pluginConfiguration {
        name = "FASTBuild Monitor"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "242"
        }
    }
    pluginVerification {
        ides {
            recommended()
        }
    }
}
