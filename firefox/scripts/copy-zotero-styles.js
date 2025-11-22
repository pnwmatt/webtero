/**
 * Copy Zotero annotation styles and license from zotero-reader to webtero
 *
 * This script copies the necessary files to replicate the Zotero annotation
 * sidebar look and feel in webtero.
 *
 * Run with: pnpm run copy-zotero-styles
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEBTERO_ROOT = path.resolve(__dirname, '..');
const ZOTERO_READER_ROOT = path.resolve(__dirname, '../../../zotero-reader');
const WEB_LIBRARY_ROOT = path.resolve(__dirname, '../../../web-library');

// Files to copy
const filesToCopy = [
  {
    src: path.join(ZOTERO_READER_ROOT, 'COPYING'),
    dest: path.join(WEBTERO_ROOT, 'ZOTERO-READER-LICENSE'),
    description: 'Zotero Reader license'
  },
  {
    src: path.join(WEB_LIBRARY_ROOT, 'COPYING'),
    dest: path.join(WEBTERO_ROOT, 'WEB-LIBRARY-LICENSE'),
    description: 'Zotero Web Library license'
  }
];

// SCSS files to reference (we manually convert key styles to CSS)
const scssReferences = [
  path.join(ZOTERO_READER_ROOT, 'src/common/stylesheets/components/_preview.scss'),
  path.join(ZOTERO_READER_ROOT, 'src/common/stylesheets/components/_annotations-view.scss'),
  path.join(ZOTERO_READER_ROOT, 'src/common/defines.js'),
];

console.log('Copying Zotero styles to webtero...\n');

// Copy license files
for (const file of filesToCopy) {
  try {
    if (fs.existsSync(file.src)) {
      fs.copyFileSync(file.src, file.dest);
      console.log(`✓ Copied ${file.description}`);
      console.log(`  ${file.src} -> ${file.dest}\n`);
    } else {
      console.log(`✗ Source not found: ${file.src}\n`);
    }
  } catch (error) {
    console.error(`✗ Error copying ${file.description}:`, error.message);
  }
}

// Log SCSS references for manual conversion
console.log('\nSCSS files referenced for style conversion:');
for (const ref of scssReferences) {
  const exists = fs.existsSync(ref);
  console.log(`  ${exists ? '✓' : '✗'} ${ref}`);
}

console.log('\n✓ Done! Annotation styles are defined in src/sidebar/sidebar.css');
console.log('  Based on zotero-reader styling from the above SCSS files.');
