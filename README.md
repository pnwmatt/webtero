# Webtero

A Firefox extension that integrates web browsing with Zotero, enabling you to save pages, create annotations, and capture snapshots directly to your Zotero library.

![webtero](https://github.com/user-attachments/assets/02b35134-2ce9-44b2-a441-20a4b997d82c)

## Features

- Save web pages to Zotero collections with metadata extraction
- Create text highlights with 8 annotation colors matching Zotero's palette
- Attach notes to highlights
- Capture full-page snapshots (via SingleFile)
- Track reading progress and time spent on pages
- OAuth authentication with Zotero Web API
- Offline annotation queue with automatic sync

## Requirements

- Firefox 142.0 or later
- Zotero account with API access

## Building

```bash
pnpm install
pnpm build
```

For development with file watching:

```bash
pnpm watch
```

## Loading the Extension

After building, load the extension from the `dist/` directory:

```bash
cd dist
web-ext run
```

To lint the extension:

```bash
cd dist
web-ext lint
```

## Project Structure

```
src/
  background/    Background service worker (message routing, API calls)
  content/       Content script (highlighting, toolbars, page tracking)
  sidebar/       Sidebar UI (project browser, annotations, page info)
  options/       Options page (authentication settings)
  lib/           Shared utilities and types
    types.ts     TypeScript interfaces (Project, Annotation, SavedPage)
    utils.ts     Helper functions
    zotero-api.ts Zotero Web API client
```

## Authentication

The extension supports two authentication methods:

1. OAuth (recommended) - Authenticate via Zotero's OAuth flow
2. API Key - Manual entry of Zotero API credentials (used for local development - disabled for distribution)

Configure authentication in the extension options page.

## License

See LICENSE file.
