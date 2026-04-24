// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'build',
        rollupOptions: {
            output: {
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`,
            },
            input: {
                monitorPanel: resolve(__dirname, 'monitor_panel.html'),
            },
        },
        minify: false,
        sourcemap: 'inline',
    },
});
