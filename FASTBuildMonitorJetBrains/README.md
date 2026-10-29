# FASTBuild Monitor for JetBrains IDEs

[FASTBuild](https://www.fastbuild.org/) is an open-source build system that speeds up C/C++ builds with parallel compilation, caching, and distributed compilation.

FASTBuild Monitor brings live build visualization to JetBrains IDEs: track progress, see concurrent jobs across local and remote workers, and inspect job status and duration.

## Requirements

- An IntelliJ Platform-based JetBrains IDE, version 2024.2 (build 242) or newer
- FASTBuild with monitoring enabled (`FBuild.exe -monitor ...`)

## Use

1. Download the JetBrains plugin ZIP from [GitHub Releases](https://github.com/felixjones/FASTBuildMonitor/releases). Alternatively, build it with `.\gradlew.bat buildPlugin` (or `./gradlew buildPlugin` on macOS/Linux); the ZIP is written to `build/distributions/`.
2. In your JetBrains IDE, open **Settings | Plugins**, choose **Install Plugin from Disk...**, and select the plugin ZIP.
3. Open **View | Tool Windows | FASTBuild Monitor**.
4. Run your build with `FBuild.exe -monitor ...`.

The log path is detected automatically. To use a custom path, open **Settings | Tools | FASTBuild Monitor**. Clear the log-path field to restore auto-detection; the detected path is shown as faded placeholder text.

Hover over a timeline segment to see its full job path, worker, status, duration, and any log message.

Failed jobs turn the progress bar red with an `error` label. Hover for diagnostics or click to open a copyable error log. Console-only errors are not available in the monitor log.

## Development

Run `.\gradlew.bat runIde` to launch a development sandbox (CLion).

## Releases

The `releaseJetBrains` GitHub Actions workflow runs on pushes to `mojang/main` that change `FASTBuildMonitorJetBrains` and can also be started manually on that branch. It inspects the latest published, non-prerelease JetBrains release and skips publishing if the files in `FASTBuildMonitorJetBrains` have not changed since that release. VS Code releases, drafts, and prereleases do not affect versioning.

Versions use `YYYY.M.patch` with the current UTC year and month without a leading zero (for example, `2027.1.0`). The patch increments from the latest JetBrains release when it belongs to the same month; otherwise it starts at `0`. No existing release also starts at patch `0`.

Release notes list only commits affecting `FASTBuildMonitorJetBrains` since that same previous JetBrains release, with links to each commit. The first release includes the plugin's full commit history. Commits changing only VS Code or other parts of the repository are excluded; commits touching both the plugin and other directories are included.

The workflow passes the calculated version to Gradle with `-PpluginVersion`; no release version is committed or written back to `build.gradle.kts`. Local builds default to the placeholder `0.0.0-dev`. To build with a specific version locally, run `.\gradlew.bat buildPlugin "-PpluginVersion=2026.10.0"`.

Releases use `JetBrains-v<version>` tags, generated release notes with manual installation instructions, and an installable plugin ZIP whose version matches the release. The workflow publishes only to GitHub Releases, not JetBrains Marketplace, and uses the automatic `GITHUB_TOKEN` without additional secrets.

Release titles say **FASTBuild Monitor for JetBrains IDEs** to distinguish them from VS Code releases.

The workflow keeps change detection, calendar versioning, the build, and publishing in named YAML steps. It uses Gradle and the GitHub CLI; no Node.js or npm dependencies are required.
