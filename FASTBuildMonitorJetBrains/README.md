# FASTBuild Monitor for JetBrains IDEs

[FASTBuild](https://www.fastbuild.org/) is an open-source build system that speeds up C/C++ builds with parallel compilation, caching, and distributed compilation.

FASTBuild Monitor brings live build visualization to JetBrains IDEs: track progress, see concurrent jobs across local and remote workers, and inspect job status and duration.

## Requirements

- An IntelliJ Platform-based JetBrains IDE, version 2024.2 (build 242) or newer
- FASTBuild with monitoring enabled (`FBuild.exe -monitor ...`)

## Use

1. Build the plugin with `.\gradlew.bat buildPlugin` (or `./gradlew buildPlugin` on macOS/Linux).
2. In your JetBrains IDE, open **Settings | Plugins**, choose **Install Plugin from Disk...**, and select `build/distributions/FASTBuildMonitorJetBrains-1.0.0.zip`.
3. Open **View | Tool Windows | FASTBuild Monitor**.
4. Run your build with `FBuild.exe -monitor ...`.

The log path is detected automatically. To use a custom path, open **Settings | Tools | FASTBuild Monitor**. Clear the log-path field to restore auto-detection; the detected path is shown as faded placeholder text.

Hover over a timeline segment to see its full job path, worker, status, duration, and any log message.

Failed jobs turn the progress bar red with an `error` label. Hover for diagnostics or click to open a copyable error log. Console-only errors are not available in the monitor log.

## Development

Run `.\gradlew.bat runIde` to launch a development sandbox (CLion).
