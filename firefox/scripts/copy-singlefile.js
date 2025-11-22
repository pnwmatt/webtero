/**
 * Copy SingleFile-Lite files from zotero-browser-extension to webtero
 *
 * Run with: pnpm run copy-singlefile
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEBTERO_ROOT = path.resolve(__dirname, '..');
const SINGLEFILE_SOURCE = path.resolve(__dirname, '../../../zotero-browser-extension/lib/SingleFile-Lite/lib');
const SINGLEFILE_DEST = path.join(WEBTERO_ROOT, 'src/lib/singlefile');

// Files to copy (what zotero-browser-extension uses)
const FILES_TO_COPY = [
  'single-file-hooks-frames.js',
  'single-file-bootstrap.js',
  'single-file.js',
];

// Ensure destination directory exists
if (!fs.existsSync(SINGLEFILE_DEST)) {
  fs.mkdirSync(SINGLEFILE_DEST, { recursive: true });
}

console.log('Copying SingleFile-Lite files to webtero...\n');

for (const file of FILES_TO_COPY) {
  const src = path.join(SINGLEFILE_SOURCE, file);
  const dest = path.join(SINGLEFILE_DEST, file);

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const stats = fs.statSync(dest);
    console.log(`  ✓ ${file} (${Math.round(stats.size / 1024)}KB)`);
  } else {
    console.log(`  ✗ Not found: ${file}`);
  }
}

// Copy the singlefile-config from zotero-browser-extension
const configSrc = path.resolve(__dirname, '../../../zotero-browser-extension/src/common/singlefile-config.js');
const configDest = path.join(SINGLEFILE_DEST, 'singlefile-config.js');
if (fs.existsSync(configSrc)) {
  fs.copyFileSync(configSrc, configDest);
  console.log(`  ✓ singlefile-config.js`);
} else {
  console.log(`  ✗ Not found: singlefile-config.js (will create default)`);
  // Create a default config
  const defaultConfig = `// SingleFile configuration for webtero
// Based on zotero-browser-extension's singlefile-config.js
export const SINGLEFILE_CONFIG = {
  removeHiddenElements: true,
  removeUnusedStyles: true,
  removeUnusedFonts: true,
  removeFrames: false,
  removeImports: true,
  removeScripts: true,
  compressHTML: false,
  compressCSS: false,
  loadDeferredImages: true,
  loadDeferredImagesMaxIdleTime: 1500,
  loadDeferredImagesBlockCookies: false,
  loadDeferredImagesBlockStorage: false,
  loadDeferredImagesKeepZoomLevel: false,
  filenameTemplate: "{page-title}",
  infobarTemplate: "",
  includeInfobar: false,
  confirmInfobarContent: false,
  autoClose: false,
  confirmFilename: false,
  filenameConflictAction: "uniquify",
  filenameMaxLength: 192,
  filenameMaxLengthUnit: "bytes",
  filenameReplacedCharacters: ["~", "+", "\\\\\\\\", "?", "%", "*", ":", "|", "\\"", "<", ">", "\\x00-\\x1f", "\\x7F"],
  filenameReplacementCharacter: "_",
  maxResourceSize: 10,
  maxResourceSizeEnabled: false,
  backgroundSave: true,
  autoSaveDelay: 1,
  autoSaveLoad: false,
  autoSaveUnload: false,
  autoSaveLoadOrUnload: false,
  autoSaveDiscard: false,
  autoSaveRemove: false,
  autoSaveRepeat: false,
  autoSaveRepeatDelay: 10,
  removeAlternativeFonts: true,
  removeAlternativeMedias: true,
  removeAlternativeImages: true,
  groupDuplicateImages: true,
  saveRawPage: false,
  saveToClipboard: false,
  addProof: false,
  saveToGDrive: false,
  saveToDropbox: false,
  saveWithWebDAV: false,
  webDAVURL: "",
  webDAVUser: "",
  webDAVPassword: "",
  saveToGitHub: false,
  githubToken: "",
  githubUser: "",
  githubRepository: "",
  githubBranch: "main",
  saveToRestFormApi: false,
  saveToS3: false,
  passReferrerOnError: false,
  insertTextBody: false,
  resolveFragmentIdentifierURLs: false,
  password: "",
  insertEmbeddedImage: false,
  preventAppendedData: false,
  selfExtractingArchive: false,
  extractDataFromPage: true,
  insertCanonicalLink: true,
  insertMetaNoIndex: false,
  insertMetaCSP: true,
  warnUnsavedPage: true,
  displayStats: false,
  displayInfobar: false,
  blockMixedContent: false,
  saveCreatedBookmarks: false,
  saveOriginalURLs: false,
  replaceEmptyTitle: false,
  includeBOM: false,
  createRootDirectory: false
};
`;
  fs.writeFileSync(configDest, defaultConfig);
  console.log(`  ✓ singlefile-config.js (created default)`);
}

console.log('\n✓ SingleFile-Lite files copied to src/lib/singlefile/');
console.log('\nNote: These files are from zotero-browser-extension and are');
console.log('      licensed under AGPL-3.0 (see SingleFile-Lite LICENSE).');
