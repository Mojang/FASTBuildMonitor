// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
module.exports = {
    branches: ['mojang/main', 'test'],
    tagFormat: 'VS-Code-v${version}',
    plugins: [
        '@semantic-release/commit-analyzer',
        '@semantic-release/release-notes-generator',
        [
            'semantic-release-vsce',
            {
                packageVsix: true,
                publish: false,
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
