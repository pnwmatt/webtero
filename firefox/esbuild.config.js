import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'firefox115',
  format: 'esm',
  logLevel: 'info',
};

// Ensure dist directory exists
if (!existsSync('dist')) {
  mkdirSync('dist', { recursive: true });
}

// Copy static files
const staticFiles = [
  { from: 'manifest.json', to: 'dist/manifest.json' },
  { from: 'src/sidebar/sidebar.html', to: 'dist/sidebar/sidebar.html' },
  { from: 'src/options/options.html', to: 'dist/options/options.html' },
  { from: 'node_modules/modern-normalize/modern-normalize.css', to: 'dist/styles/reset.css' },
];

staticFiles.forEach(({ from, to }) => {
  const toDir = to.substring(0, to.lastIndexOf('/'));
  if (!existsSync(toDir)) {
    mkdirSync(toDir, { recursive: true });
  }
  if (existsSync(from)) {
    copyFileSync(from, to);
  }
});

// Build configurations for each entry point
const builds = [
  {
    ...commonOptions,
    entryPoints: ['src/background/background.ts'],
    outfile: 'dist/background/background.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/sidebar/sidebar.ts'],
    outfile: 'dist/sidebar/sidebar.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/content.ts'],
    outfile: 'dist/content/content.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/options/options.ts'],
    outfile: 'dist/options/options.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/sidebar/sidebar.css'],
    outfile: 'dist/sidebar/sidebar.css',
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/content.css'],
    outfile: 'dist/content/content.css',
  },
  {
    ...commonOptions,
    entryPoints: ['src/options/options.css'],
    outfile: 'dist/options/options.css',
  },
];

async function build() {
  if (isWatch) {
    const contexts = await Promise.all(
      builds.map((config) => esbuild.context(config))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(builds.map((config) => esbuild.build(config)));
    console.log('Build complete!');
  }
}

build().catch(() => process.exit(1));
