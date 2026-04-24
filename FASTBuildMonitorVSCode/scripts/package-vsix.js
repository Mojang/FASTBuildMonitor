// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


/**
 * Package a VS Code extension and emit the VSIX into the repository artifacts/ directory.
 * Uses version from root package.json as single source of truth.
 * Usage: node package-vsix.js <projectDir> <baseName> [--pre-release]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node package-vsix.js <projectDir> <baseName> [--pre-release]');
  process.exit(1);
}

const projectDir = path.resolve(__dirname, '..', args[0]);
const baseName = args[1];
const isPreRelease = args.includes('--pre-release');

// Read version from ROOT package.json (single source of truth)
const repoRoot = path.resolve(__dirname, '..');
const rootPkgPath = path.join(repoRoot, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const version = rootPkg.version;

if (!version) {
  console.error(`Root package.json at ${rootPkgPath} is missing a version field.`);
  process.exit(1);
}

// Update the project's package.json version from root
const pkgPath = path.join(projectDir, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error(`package.json not found at ${pkgPath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  // Use OS-specific line ending (CRLF on Windows)
  const eol = require('os').EOL;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + eol, 'utf8');
  console.log(`  Synced ${path.basename(projectDir)} version to ${version}`);
}

const artifactsDir = path.resolve(__dirname, '..', 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });

const vsixName = `${baseName}-${version}.vsix`;
const outPath = path.join(artifactsDir, vsixName);

const vsceArgs = ['@vscode/vsce', 'package', '--out', outPath];
if (isPreRelease) {
  vsceArgs.push('--pre-release');
}

const result = spawnSync('npx', vsceArgs, {
  cwd: projectDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, npm_config_yes: 'true' }
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
