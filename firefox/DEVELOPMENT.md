# Webtero Development Guide

## Building the Extension

### Install Dependencies
```bash
pnpm install
```

### Build for Production
```bash
pnpm run build
```

This will compile all TypeScript files and copy static assets to the `dist/` directory.

### Watch Mode (Development)
```bash
pnpm run watch
```

This will watch for file changes and automatically rebuild.

### Clean Build
```bash
pnpm run clean
pnpm run build
```

## Loading the Extension in Firefox

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on"
4. Navigate to the `dist/` directory and select `manifest.json`

The extension will be loaded and the sidebar will automatically open.

## Project Structure

```
/firefox
├── src/                      # Source files
│   ├── lib/                  # Shared libraries
│   │   ├── types.ts          # TypeScript type definitions
│   │   ├── storage.ts        # browser.storage.local wrapper
│   │   ├── zotero-api.ts     # Zotero Web API client
│   │   ├── zotero-connector.ts  # Local Zotero connector
│   │   └── utils.ts          # Utility functions
│   ├── background/           # Background service worker
│   │   └── background.ts
│   ├── sidebar/              # Sidebar panel
│   │   ├── sidebar.html
│   │   ├── sidebar.ts
│   │   └── sidebar.css
│   ├── content/              # Content scripts
│   │   ├── content.ts
│   │   └── content.css
│   └── options/              # Settings page
│       ├── options.html
│       ├── options.ts
│       └── options.css
├── dist/                     # Build output (gitignored)
├── manifest.json             # Extension manifest
├── package.json
├── tsconfig.json
└── esbuild.config.js
```

## Development Workflow

1. Make changes to source files in `src/`
2. Build outputs to `dist/` via `pnpm run build` or `pnpm run watch`
3. Reload the extension in Firefox:
   - Go to `about:debugging`
   - Click "Reload" on the Webtero extension
4. Test changes in the browser

## Key Features Implemented

### MVP Features
- ✅ OAuth/API key configuration (stubbed)
- ✅ Project management (sync from Zotero Collections)
- ✅ Save current page to Zotero
- ✅ Create annotations with multiple highlight colors
- ✅ Visual highlights on page
- ✅ Annotation display in sidebar
- ✅ Zotero Connector integration

### Highlight Colors
- Yellow (default)
- Green
- Blue
- Pink
- Purple

## Configuration

### Zotero API Key
1. Open extension settings (click ⚙ in sidebar or go to `about:addons`)
2. Enter your Zotero API key (get one from https://www.zotero.org/settings/keys)
3. Save credentials

### Zotero Connector
The extension will automatically detect if Zotero is running locally on port 23119.

## Troubleshooting

### Extension Not Loading
- Ensure `pnpm run build` completed successfully
- Check that `dist/manifest.json` exists
- Look for errors in the Firefox Browser Console

### API Errors
- Verify your Zotero API key is valid
- Check that you have network access to api.zotero.org
- User ID is currently hardcoded to "12345" for MVP

### Highlights Not Appearing
- Ensure the page is saved to Zotero first
- Check the Browser Console for errors
- Try refreshing annotations in the sidebar

### Build Errors
- Delete `node_modules/` and run `pnpm install` again
- Delete `dist/` and run `pnpm run clean && pnpm run build`
- Check that TypeScript version is 5.3.3 or higher

## Next Steps (Post-MVP)

- Implement full OAuth flow
- Add page % read tracking
- Implement child page auto-capture
- Add link indicators for Zotero'd pages
- Implement snapshot versioning
- Add change detection
- Cross-device sync
