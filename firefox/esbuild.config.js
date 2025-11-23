import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const isWatch = process.argv.includes('--watch');

// Load environment variables from .env file
function loadEnv() {
  const envPath = '.env';
  const defaults = {
    FEATURE_OAUTH_ENABLED: 'false',
    ZOTERO_OAUTH_CLIENT_KEY: '',
    ZOTERO_OAUTH_CLIENT_SECRET: '',
  };

  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          defaults[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  }

  return defaults;
}

const env = loadEnv();

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'firefox115',
  format: 'esm',
  logLevel: 'info',
  define: {
    '__FEATURE_OAUTH_ENABLED__': env.FEATURE_OAUTH_ENABLED === 'true' ? 'true' : 'false',
    '__ZOTERO_OAUTH_CLIENT_KEY__': JSON.stringify(env.ZOTERO_OAUTH_CLIENT_KEY || ''),
    '__ZOTERO_OAUTH_CLIENT_SECRET__': JSON.stringify(env.ZOTERO_OAUTH_CLIENT_SECRET || ''),
  },
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
  // SingleFile files for snapshot capture
  { from: 'src/lib/singlefile/single-file-hooks-frames.js', to: 'dist/lib/singlefile/single-file-hooks-frames.js' },
  { from: 'src/lib/singlefile/single-file-bootstrap.js', to: 'dist/lib/singlefile/single-file-bootstrap.js' },
  { from: 'src/lib/singlefile/single-file.js', to: 'dist/lib/singlefile/single-file.js' },
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
