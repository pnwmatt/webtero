# Webtero

> [!WARNING]
> At this moment Mozilla is still reviewing the app store listing for Webtero, meaning it isn't available or able to be distributed easily yet. If you'd like to try it out before its approved:
> 
> 1. Download `webtero-0.1.*.zip` from [Releases](https://github.com/pnwmatt/webtero/releases)
> 2. Unzip it
> 3. Go to Firefox Debug Extensions (Copy/paste this url: `about:debugging#/runtime/this-firefox`) and "Load a Temporary Add-on...". Find the directory where you unzipped webtero and choose the manifest.json to load.
> 4. The sidebar should open and you can now authenticate into Webtero securely using OAuth.

A Firefox extension that integrates web browsing with Zotero, enabling you to save pages, create annotations, and capture snapshots directly to your Zotero library.

![webtero](https://github.com/user-attachments/assets/02b35134-2ce9-44b2-a441-20a4b997d82c)

## Features

- "Save" button archives the web pages to a specific Zotero Project
  - Any link you click from a "Saved" page will be auto-saved to your library
  - Links on the page you're viewing to a page in Zotero will have a webtero badge appended so you can see which links you've stored, how much you've read, and a summary of the annotations on that page
- Select text to show a popup to pick one of with Zotero's 8 color options to store the annotation
  - You can attach notes to annotations
  - You don't have to wait for the save to complete (or start): making an annotation starts (or waits) for the save, and then saves the annotations to the save once it's complete
- Full-page snapshots use the same technique as the Zotero Connect browser plugins
- Track reading progress, time spent on pages, and referer (saved locally in your browser)
- OAuth authentication with Zotero Web API

## Privacy Notes

- Does not communicate with any services except Zotero.com - your data is as private as your Zotero collection already is

## Requirements

- Firefox 142.0 or later
- Zotero.com Web Library

## Limitations

- Currently doesn't support PDFs in the browser, but can later.  It's just not a flow I use so I didn't prioritize it.
- Built specifically for Firefox because:
  1. Corporations like Google are ruining the internet and paying for the destruction of the East Wing of the White House
  2. Firefox supports Sidebars, which felt like an intuitive way to support this feature

## FAQ

- Forward/backward compatible: Annotations made in Zotero on a webpage (in the client or Zotero.com Web Library) will be visible when you surf to that page in Firefox.  Annotations made with Webtero are equally visible when viewing in the client or Zotero.com Web Library.
- Uses your Zotero storage at the moment
- Does not connect with your local Zotero, instead currently uses the Web API for Zotero (so your library must be synced with Zotero.com).  This can be fixed in the future but out-of-the-box Zotero's local APIs don't support this functionality.
- There is no paywall or paid features beyond your existing way of managing your Zotero storage (although the author is unemployed so [sponsorship](https://github.com/sponsors/pnwmatt) is appreciated!)

## Configurable Settings

In the Webtero Sidebar, the gear icon allows you to:

- Disable Auto-Save
- Disable Link Indicators that you've saved the destination of a link to your Zotero
- Disable read progress tracking

# Contributions are Welcome

## Building

```bash
pnpm install
pnpm build
```

For development with file watching:

```bash
pnpm web-ext watch
```

## Loading the Extension

After building, load the extension from the `dist/` directory:

```bash
cd dist
pnpm web-ext run
```

To lint the extension:

```bash
cd dist
pnpm web-ext lint
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
2. API Key - Manual entry of Zotero API credentials

Configure authentication in the extension options page.

## License

See LICENSE file.
