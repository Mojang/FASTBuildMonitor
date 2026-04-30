# Release Process
This repository uses [semantic-release](https://github.com/semantic-release/semantic-release) for it's releases.  That means that any commit that goes into `mojang/main` will potentially trigger a release and contribute to the changelog.


# Pull Request Guidelines
Pull request titles must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format.  

The general format is: `<type>[optional scope]: <description>`

Some examples of this are:

- `feat(diagnostics): Added more data to statistics panel`
- `chore: Added CONTRIBUTING.md`


# Local Development

Initialize
```bash
npm install:all
```

Build
```bash
npm run build:all
```

To test: press F5 in VS Code to launch the Extension Development Host.

# Architecture

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


# Known Issues and TODO

- [ ] Improve tooltips.
- [ ] Better scrolling behavior to navigate to previous events.
- [ ] Ability to expand workers (watch cores).
- [ ] More detailed task information, navigate to messages when clicking tasks.
- [x] Use React to improve rendering performance and dev loop (avoid having code into strings).
- [ ] Support theming.