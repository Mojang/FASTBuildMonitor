## Development and tests

From `FASTBuildMonitorVSCode`, using Node.js 24:

```bash
npm run ci:all
npm test
npm run test:coverage
```

Vitest covers the extension core and React web UI. Pull requests automatically build both parts, type-check tests, and validate coverage. 

# Release Process
This repository uses [semantic-release](https://github.com/semantic-release/semantic-release) for it's releases.  That means that any commit that goes into `mojang/main` will potentially trigger a release and contribute to the changelog.


# Pull Request Guidelines
Pull request titles must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format.  

The general format is: `<type>[optional scope]: <description>`

Some examples of this are:

- `feat(diagnostics): Added more data to statistics panel`
- `chore: Added CONTRIBUTING.md`


# Local Development

Use Node.js 24. Run the following commands from `FASTBuildMonitorVSCode`.

Install the extension and webview dependencies from the committed lockfiles:
```bash
npm run ci:all
```

When changing dependencies, use `npm run install:all` and commit both updated lockfiles.

Build:
```bash
npm run build:all
```

## Automated tests

The project uses [Vitest](https://vitest.dev/) with two projects:

- `extension`: Node-based tests in `tests/extension` covering log polling and parsing, build sessions and workers, configuration and utilities, activation, commands, status updates, and webview messaging.
- `webview`: React Testing Library tests in `webview-ui/tests`, running in jsdom, covering snapshot updates, controls, statistics, job lists, themes, progress contrast, and timeline rendering, core allocation, scrolling, zooming, and tooltips.

Run both suites once:

```bash
npm test
```

Run a single project or use watch mode:

```bash
npm test -- --project extension
npm test -- --project webview
npm test -- --watch
```

Type-check the tests and collect coverage:

```bash
npm run test:typecheck
npm run test:coverage
```

Coverage includes all extension and webview TypeScript sources, including files not imported by a test. Declaration files are excluded. Every source file must meet at least **80% statements, lines, and functions**, and **75% branches**. Reports are written to `coverage`; open `coverage/index.html` for the detailed report. Add behavior-focused regression tests alongside changes rather than excluding uncovered production code.

The extension tests mock the VS Code API and file polling boundaries, and use fake timers instead of real polling delays. Webview tests mock the VS Code bridge, canvas operations/pixel samples, and resize observers. They do not require VS Code, a running FASTBuild process, or a browser. These tests do not replace visual checks of actual canvas rendering: press F5 in VS Code to launch the Extension Development Host for manual validation.

The [CI workflow](../.github/workflows/ci.yml) runs on pull requests when opened, updated, or reopened. It installs locked dependencies, builds both parts, type-checks tests, enforces coverage thresholds, and uploads the coverage report. It uses read-only repository permissions and does not require release credentials. To enforce it before merging, configure the **Build and Test** check as required in branch protection.

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