# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

All commands use **pnpm** (not npm):

```bash
pnpm install        # Install dependencies
pnpm run build      # Build extension to dist/
pnpm run watch      # Watch mode for development
pnpm run clean      # Remove dist/ directory
```

**Load in Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → select `dist/manifest.json`

## Tech Stack

- TypeScript 5.3.3 with strict mode (ES2020 target)
- esbuild 0.20.0 bundler
- Firefox Manifest V3 extension (requires Firefox 115+)
- Zotero Web API v3 + Local Zotero Connector API

## Architecture

Firefox sidebar extension that syncs web research with Zotero. Projects map to Zotero collections, saved pages become webpage items, and annotations become child notes.

### Components

| Component | Entry Point | Role |
|-----------|-------------|------|
| Background | `src/background/background.ts` | Service worker, message hub, API coordination |
| Sidebar | `src/sidebar/sidebar.ts` | Primary UI, project list, page save, annotations |
| Content Script | `src/content/content.ts` | Text selection, highlight toolbar, XPath-based highlights |
| Options | `src/options/options.ts` | API key config, Zotero Connector status |

### Shared Libraries (`src/lib/`)

- `types.ts` - Core interfaces (Project, SavedPage, Annotation, StorageData)
- `storage.ts` - Typed wrapper for `browser.storage.local`
- `zotero-api.ts` - REST client for Zotero Web API (https://api.zotero.org)
- `zotero-connector.ts` - Local Zotero client (http://127.0.0.1:23119)
- `utils.ts` - XPath helpers, URL normalization, date formatting

### Message Protocol

Components communicate via `browser.runtime.sendMessage()` with these message types:
- `GET_PAGE_DATA`, `SAVE_PAGE` - Page operations
- `CREATE_ANNOTATION`, `GET_ANNOTATIONS`, `DELETE_ANNOTATION` - Annotation operations
- `SYNC_PROJECTS` - Sync collections from Zotero

## Key Implementation Details

- **URLs** are normalized before storage (hash removed, trailing slash stripped) for consistent lookups
- **Annotations** use XPath + character offset for position tracking (may break with significant DOM changes)
- **User ID** is hardcoded to "12345" for MVP (needs OAuth 1.0a for production)
- **Highlight colors**: yellow (#ffeb3b), green (#4caf50), blue (#2196f3), pink (#e91e63), purple (#9c27b0)
