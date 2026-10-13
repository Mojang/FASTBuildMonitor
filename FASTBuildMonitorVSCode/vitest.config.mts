// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        watch: false,
        projects: [
            {
                resolve: {
                    alias: {
                        vscode: fileURLToPath(new URL('./tests/mocks/vscode.ts', import.meta.url)),
                    },
                },
                test: {
                    name: 'extension',
                    environment: 'node',
                    include: ['tests/extension/**/*.test.ts'],
                    setupFiles: ['tests/setup.ts'],
                    clearMocks: true,
                    restoreMocks: true,
                },
            },
            {
                esbuild: { jsx: 'automatic' },
                test: {
                    name: 'webview',
                    environment: 'jsdom',
                    include: ['webview-ui/tests/**/*.test.{ts,tsx}'],
                    setupFiles: ['webview-ui/tests/setup.ts'],
                    clearMocks: true,
                    restoreMocks: true,
                },
            },
        ],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts', 'webview-ui/src/**/*.{ts,tsx}'],
            exclude: ['**/*.d.ts'],
            reporter: ['text', 'html', 'lcov', 'json-summary'],
            thresholds: {
                perFile: true,
                statements: 80,
                branches: 75,
                functions: 80,
                lines: 80,
            },
        },
    },
});
