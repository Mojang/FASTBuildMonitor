<h1 align="center">
  <br>
  FASTBuild Monitor
  <br>
</h1>

<h4 align="center">Real-time monitoring of <a href="http://www.fastbuild.org/">FASTBuild</a> distributed builds directly inside VS Code, with a Gantt-chart timeline, worker tracking, and build statistics.</h4>


<p align="center">
<img src="./images/monitor.png" width=75%>
</p>


## Features

- **Timeline/Gantt chart** — Canvas-rendered visualization of build jobs across workers, color-coded by status
- **Job tooltips** — Hover over any job bar to see name, host, status, and duration
- **Worker panel** — Live active/total/cached job counts per worker host
- **Build statistics** — Total, active, succeeded, cached, and failed counts
- **Progress bar** — Overall build progress percentage
- **Recent jobs list** — Scrollable feed of the latest jobs with status and timing
- **Status bar integration** — See build progress/status at a glance in the VS Code status bar
- **Zoom & scroll** — Ctrl+wheel zoom, plus zoom in/out/reset buttons
- **Auto-start** — Optionally begin monitoring as soon as the panel opens

## Getting Started

Your first step will be to install the Visual Studio Code Extension from latest release: https://github.com/Mojang/FASTBuildMonitor/releases

To add this to VS Code, go to extensions (Ctrl + X), expand the menu under the three dots "...", and select the installer file (fbuild-monitor-X.X.X.vsix):

![image](./images/install.png)


## Usage

1. Open VS Code
2. Run **FASTBuild Monitor: Show Build Monitor** from the command palette (Ctrl+Shift+P)
3. Launch your FASTBuild build with the `-monitor` flag:
   ```bash
   FBuild.exe -monitor ...
   ```
4. The monitor will pick up build events in real-time

### Commands

| Command                                 | Description                 |
| --------------------------------------- | --------------------------- |
| `FASTBuild Monitor: Show Build Monitor` | Open the monitor panel      |
| `FASTBuild Monitor: Start Monitoring`   | Start watching the log file |
| `FASTBuild Monitor: Stop Monitoring`    | Stop watching               |

### Settings

| Setting                      | Default | Description                                                                                               |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `fbuildmonitor.logPath`      | `""`    | Custom path to `FastBuildLog.log`. Empty = auto-detect from `%TEMP%\FASTBuild\` or `FASTBUILD_TEMP_PATH`. |
| `fbuildmonitor.pollInterval` | `500`   | Log file poll interval in milliseconds (100–5000).                                                        |
| `fbuildmonitor.autoStart`    | `true`  | Auto-start monitoring when the panel opens.                                                               |

## Development

Initialize
```bash
npm install:all
```

Build
```bash
npm run build:all
```

To test: press F5 in VS Code to launch the Extension Development Host.

## Release

Execute script
```bash
npm run release
```

## Architecture

```
src/
├── extension.ts           — Extension entry point, commands, status bar
├── logWatcher.ts          — Polls FASTBuild log file for new content
├── buildWatcher.ts        — Tokenizes log lines → typed BuildEvent objects
├── buildMonitorService.ts — Maintains build state (sessions, jobs, workers)
├── monitorPanel.ts        — Webview panel management and starting point.
└── model.ts               — Shared types and enums
webview-ui/
└── monitor_panel/
    └── App.tsx            — React web view root for the monitor panel.
```


### Known Issues and TODO

- [ ] Improve tooltips.
- [ ] Better scrolling behavior to navigate to previous events.
- [ ] Ability to expand workers (watch cores).
- [ ] More detailed task information, navigate to messages when clicking tasks.
- [x] Use React to improve rendering performance and dev loop (avoid having code into strings).
- [ ] Support theming.
