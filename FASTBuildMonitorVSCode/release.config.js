// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
const { execFileSync } = require('node:child_process');

// Workflow path filters select pushes, not commits. Only this plugin's commits
// should influence its version and release notes.
function getPluginCommits(context) {
    const previousCommit = context.lastRelease.gitHead;
    const currentCommit = context.nextRelease?.gitHead ?? 'HEAD';
    const commitRange = previousCommit ? `${previousCommit}..${currentCommit}` : currentCommit;

    // Running from this config's directory makes "." refer to this plugin only.
    const gitLog = execFileSync('git', ['log', '--format=%H', commitRange, '--', '.'], {
        cwd: __dirname,
        encoding: 'utf8',
    });
    const pluginCommitHashes = new Set(gitLog.trim().split(/\r?\n/));

    return context.commits.filter(commit => pluginCommitHashes.has(commit.hash));
}

module.exports = {
    branches: ['mojang/main', 'test'],
    tagFormat: 'VS-Code-v${version}',
    plugins: [
        // Keep the standard plugins, but give both the same directory-filtered commits.
        {
            async analyzeCommits(pluginConfig, context) {
                const { analyzeCommits } = await import('@semantic-release/commit-analyzer');
                return analyzeCommits(pluginConfig, {
                    ...context,
                    commits: getPluginCommits(context),
                });
            },
            async generateNotes(pluginConfig, context) {
                const { generateNotes } = await import('@semantic-release/release-notes-generator');
                return generateNotes(pluginConfig, {
                    ...context,
                    commits: getPluginCommits(context),
                });
            },
        },
        [
            'semantic-release-vsce',
            {
                packageVsix: true,
            },
        ],
        [
            '@semantic-release/github',
            {
                assets: [
                    {
                        path: '*.vsix',
                    },
                ],
            },
        ],
    ],
};
