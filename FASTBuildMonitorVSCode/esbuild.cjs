// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const esbuild = require('esbuild');
const { copy } = require('esbuild-plugin-copy');
const path = require('path');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
	// Copy source-map wasm file to dist folder
    const copySourceMapWasm = copy({
        // this is equal to process.cwd(), which means we use cwd path as base path to resolve `to` path
        // if not specified, this plugin uses ESBuild.build outdir/outfile options as base path.
        resolveFrom: 'cwd',
        assets: {
            from: ['./node_modules/source-map/lib/*.wasm'],
            to: ['./out'],
        },
        watch: watch,
    });

	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'out/extension.js',
		external: ['vscode'],
		logLevel: 'info',
		plugins: [esbuildProblemMatcherPlugin, copySourceMapWasm,
			{
				name: 'copy-content',
				setup(build) {
					build.onEnd(() => {
						const contentSrc = path.resolve(__dirname, 'images');
						const contentDest = path.resolve(__dirname, 'out', 'images');

						if (fs.existsSync(contentSrc)) {
							console.log('Copying content directory...');
							fs.rmSync(contentDest, { recursive: true, force: true });
							fs.mkdirSync(contentDest, { recursive: true });

							// Copy entire content directory recursively
							fs.cpSync(contentSrc, contentDest, { recursive: true });
							console.log('Content directory copied successfully');
						}
					});
				}
			}
		]
	});

	if (watch) {
		await ctx.watch();
		console.log('Watching for changes...');
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd(result => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            });
            console.log('[watch] build finished');
        });
    },
};

main().catch(e => {
	console.error(e);
	process.exit(1);
});
