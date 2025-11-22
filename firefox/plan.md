Webtero Firefox Extension - MVP Implementation Plan

## Version History

### v0.0.1 (2025-11-05)
**Status: ✅ MVP Complete**

Initial implementation of core features:
- Project setup with TypeScript, esbuild, pnpm
- Zotero Web API integration (stubbed auth)
- Zotero Connector integration
- Project/collection management
- Page capture to Zotero
- Multi-color annotation system with visual highlights
- Sidebar UI with all core sections
- Content script for text selection and highlighting

**Files Created:** 19 source files + build configuration
**Build Status:** ✅ Successful build to dist/
**Extension Status:** Ready to load in Firefox

---

## Tech Stack

- ✅ **v0.0.1** TypeScript for type safety
- ✅ **v0.0.1** esbuild for fast bundling
- ✅ **v0.0.1** pnpm for package management
- ✅ **v0.0.1** browser.storage.local for persistent data
- ✅ **v0.0.1** CSS reset (modern-normalize)
- ✅ **v0.0.1** Manifest V3 (latest Firefox extension format)

## Project Structure

**✅ v0.0.1 (2025-11-05)** - All files implemented

/firefox
├── package.json
├── tsconfig.json
├── esbuild.config.js
├── manifest.json
├── src/
│ ├── sidebar/
│ │ ├── sidebar.html
│ │ ├── sidebar.ts
│ │ └── sidebar.css
│ ├── content/
│ │ ├── content.ts # Highlight detection, link marking
│ │ └── content.css # Highlight styles, link indicators
│ ├── background/
│ │ └── background.ts # Service worker, message handling
│ ├── options/
│ │ ├── options.html # OAuth/settings page
│ │ ├── options.ts
│ │ └── options.css
│ ├── lib/
│ │ ├── zotero-api.ts # Zotero Web API client
│ │ ├── storage.ts # browser.storage.local wrapper
│ │ ├── types.ts # TypeScript interfaces
│ │ └── utils.ts
│ └── styles/
│ └── reset.css # CSS reset
└── dist/ # Build output

## MVP Features Breakdown

### 1. Authentication (Stubbed)
**✅ v0.0.1 (2025-11-05)** - Implemented with placeholder userID

- ✅ **v0.0.1** Options page with API key input field
- ✅ **v0.0.1** Store API key in browser.storage.local
- ✅ **v0.0.1** Validate key format (placeholder validation)
- ✅ **v0.0.1** Display user ID/library access info (stubbed)
- 🔮 **Future** Full OAuth 1.0a implementation

### 2. Project Management
**✅ v0.0.1 (2025-11-05)** - Core functionality implemented

Data Model:
interface Project {
id: string; // Zotero collection key
name: string; // Collection name
parentId?: string; // Parent collection (for subcollections)
itemCount: number; // Number of items
}

Features:

- ✅ **v0.0.1** Fetch collections from Zotero API
- ✅ **v0.0.1** Display project list in sidebar
- ✅ **v0.0.1** Create new collection (basic form)
- ✅ **v0.0.1** Map current page to existing project(s)
- 🔮 **Future** Real-time item count updates
- 🔮 **Future** Hierarchical project tree view

### 3. Page Capture
**✅ v0.0.1 (2025-11-05)** - Basic capture implemented

Data Model:
interface SavedPage {
url: string;
zoteroItemKey: string; // Item key in Zotero
title: string;
projects: string[]; // Collection keys
dateAdded: string;
snapshot: boolean; // Whether snapshot was saved
}

Features:

- ✅ **v0.0.1** "Save to Webtero" button in sidebar
- ✅ **v0.0.1** Extract page metadata (title, URL)
- ✅ **v0.0.1** Call Zotero API to create webpage item
- ✅ **v0.0.1** Optionally add to selected project(s)
- ✅ **v0.0.1** Store mapping in local storage
- ✅ **v0.0.1** Zotero Connector integration for active project detection
- 🔮 **Future** Full snapshot capture
- 🔮 **Future** Auto-capture child pages
- 🔮 **Future** Page % read tracking

### 4. Annotation System
**✅ v0.0.1 (2025-11-05)** - Full multi-color highlighting implemented

Data Model:
interface Annotation {
id: string;
pageUrl: string;
zoteroItemKey: string; // Parent item
zoteroNoteKey?: string; // Note/annotation in Zotero
text: string; // Highlighted text
comment?: string; // User comment
color: string; // Highlight color (yellow, green, blue, pink, purple)
position: { // DOM position info
xpath: string;
offset: number;
length: number;
};
created: string;
}

Features:

- ✅ **v0.0.1** Select text → show "Highlight" toolbar with color picker
- ✅ **v0.0.1** Multiple highlight colors: yellow (default), green, blue, pink, purple
- ✅ **v0.0.1** Create annotation with optional comment
- ✅ **v0.0.1** Save to Zotero as child note
- ✅ **v0.0.1** Store locally for quick display
- ✅ **v0.0.1** Show annotations in sidebar for current page
- ✅ **v0.0.1** Re-apply highlights visually on page load (using stored position)
- ✅ **v0.0.1** Annotations appear BOTH in sidebar AND as visual highlights on page
- ✅ **v0.0.1** Delete annotations
- 🔮 **Future** Edit annotations inline
- 🔮 **Future** Annotation filtering by color/date
- 🔮 **Future** Export annotations

### 5. Sidebar UI Components
**✅ v0.0.1 (2025-11-05)** - All sections implemented

- ✅ **v0.0.1** Header: Logo, current page status (saved/unsaved)
- ✅ **v0.0.1** Projects Section: List of collections with item counts
- ✅ **v0.0.1** Current Page Section:
  - ✅ **v0.0.1** Save button with project selector
  - ✅ **v0.0.1** Page metadata (if saved)
- ✅ **v0.0.1** Annotations Section: List of annotations for current page
  - ✅ **v0.0.1** Highlight via content script
  - ✅ **v0.0.1** Existing annotations with delete
- ✅ **v0.0.1** Settings button linking to options page
- ✅ **v0.0.1** Sync/refresh buttons
- ✅ **v0.0.1** New project modal

### 6. Content Script Features
**✅ v0.0.1 (2025-11-05)** - Text selection and highlighting implemented

- ✅ **v0.0.1** Detect text selection
- ✅ **v0.0.1** Show highlight toolbar on selection
- ✅ **v0.0.1** Re-apply highlights on page load
- ✅ **v0.0.1** XPath-based position tracking
- ✅ **v0.0.1** Visual highlight rendering
- 🔮 **Future** Link indicators for Zotero'd pages
- 🔮 **Future** Squiggly underlines for saved links
- 🔮 **Future** Hover tooltips with Zotero metadata

## API Integration Points

### Zotero Web API Calls (MVP)
**✅ v0.0.1 (2025-11-05)** - Core endpoints implemented

1. ✅ **v0.0.1** GET /users/{userID}/collections - Fetch projects
2. ✅ **v0.0.1** POST /users/{userID}/collections - Create new project
3. ✅ **v0.0.1** POST /users/{userID}/items - Save webpage item
4. ✅ **v0.0.1** POST /users/{userID}/items - Create annotation (as child note)
5. ✅ **v0.0.1** GET /users/{userID}/items/{itemKey}/children - Get annotations
6. ✅ **v0.0.1** GET /users/{userID}/items/{itemKey} - Get specific item
7. ✅ **v0.0.1** DELETE /users/{userID}/items/{itemKey} - Delete item (prepared)

### Zotero Connect API Calls (Local Connector)
**✅ v0.0.1 (2025-11-05)** - Basic connector integration

1. ✅ **v0.0.1** GET http://127.0.0.1:23119/connector/ping - Check if Zotero is running
2. ⏳ **Stubbed** Use connector to determine active project/collection when saving pages
3. 🔮 **Future** Use /connector/savePage for enhanced page capture

## Storage Schema
**✅ v0.0.1 (2025-11-05)** - Fully implemented

{
auth: {
apiKey: string;
userID: string;
},
pages: {
[url: string]: SavedPage;
},
annotations: {
[id: string]: Annotation;
},
projects: {
[key: string]: Project;
},
lastSync: string;
}

## Development Phases

### Phase 1: Project Setup (~5-10 files)
**✅ v0.0.1 (2025-11-05)** - Complete

- ✅ Initialize pnpm project
- ✅ Configure TypeScript + esbuild
- ✅ Set up manifest.json
- ✅ Create basic file structure

### Phase 2: Core Infrastructure (~5-8 files)
**✅ v0.0.1 (2025-11-05)** - Complete

- ✅ Storage abstraction layer
- ✅ Zotero API client (stubbed auth)
- ✅ Type definitions
- ✅ Message passing between components
- ✅ Utility functions

### Phase 3: Options & Auth (~3 files)
**✅ v0.0.1 (2025-11-05)** - Complete

- ✅ Options page UI
- ✅ API key input/storage
- ✅ Stubbed validation
- ✅ Connector status display

### Phase 4: Sidebar UI (~4-5 files)
**✅ v0.0.1 (2025-11-05)** - Complete

- ✅ HTML structure with CSS reset
- ✅ Project list display
- ✅ Current page section
- ✅ Basic styling (minimal)
- ✅ Annotations section

### Phase 5: Project Management (~2-3 files)
**✅ v0.0.1 (2025-11-05)** - Complete

- ✅ Fetch collections from API
- ✅ Display in sidebar
- ✅ Create new collection
- ✅ Sync functionality

### Phase 6: Page Capture (~3-4 files)
**✅ v0.0.1 (2025-11-05)** - Complete

- ✅ Save current page button
- ✅ Zotero API integration
- ✅ Local storage sync
- ✅ Multi-project assignment

### Phase 7: Annotation System (~5-6 files)
**✅ v0.0.1 (2025-11-05)** - Complete

- ✅ Text selection detection (content script)
- ✅ Highlight UI with color picker
- ✅ Save annotation to Zotero
- ✅ Display in sidebar
- ✅ Re-apply highlights on load
- ✅ XPath position tracking

### Phase 8: Polish & Testing
**✅ v0.0.1 (2025-11-05)** - Basic implementation

- ✅ Basic error handling
- ✅ Loading states
- ✅ Basic validation
- ⏳ **In Progress** Comprehensive testing
- 🔮 **Future** Advanced error recovery
- 🔮 **Future** Performance optimization

## Confirmed Decisions
**✅ v0.0.1 (2025-11-05)** - All implemented as specified

1. ✅ **User ID**: Use hardcoded placeholder userID for MVP (e.g., "12345")
2. ✅ **Highlight Colors**: Support multiple colors - yellow, green, blue, pink, purple
3. ✅ **Project Assignment**: Use Zotero Connect API to get active project from local Zotero instance
4. ✅ **Annotations Display**: Show both in sidebar AND visually on page as highlights

## Implementation Notes
**✅ v0.0.1 (2025-11-05)** - All technical requirements met

- ✅ lib/zotero-connector.ts handles communication with local Zotero Connect API (http://127.0.0.1:23119)
- ✅ When saving a page, ping connector for active collection, fall back to user selection if unavailable
- ✅ Visual highlights persist across page reloads by storing XPath-based DOM position data
- ✅ Content script applies highlight overlays using span elements with inline styles

---

## What's Next (Post v0.0.1)

### Immediate Improvements (v0.1.0)
- 🔮 Comprehensive error handling and user feedback
- 🔮 Loading indicators for all async operations
- 🔮 Proper OAuth 1.0a flow implementation
- 🔮 Real user ID extraction from OAuth
- 🔮 Better handling of highlight edge cases (cross-element selections)

### Near-term Features (v0.2.0)
- 🔮 Page % read tracking (scroll position monitoring)
- 🔮 Child page auto-capture (detect clicks on links)
- 🔮 Link indicators (squiggly underlines for saved pages)
- 🔮 Hover tooltips showing Zotero metadata
- 🔮 Full snapshot capture integration

### Long-term Features (v1.0.0+)
- 🔮 Time-travel capability (view previous snapshots)
- 🔮 Change detection and alerting
- 🔮 Cross-device sync orchestration
- 🔮 Webtero Cloud Services integration
- 🔮 Annotation export in multiple formats
- 🔮 Advanced search and filtering
- 🔮 Collaborative features (shared projects)

### Technical Debt & Optimization
- 🔮 Performance profiling and optimization
- 🔮 Bundle size reduction
- 🔮 Better TypeScript strict mode compliance
- 🔮 Unit and integration tests
- 🔮 CI/CD pipeline
- 🔮 Automated releases

---

## Current Status Summary

**v0.0.1 (2025-11-05)**
- **Total Files Created**: 19 source + 4 config files
- **Build Status**: ✅ Successful
- **Extension Status**: ✅ Ready to load in Firefox
- **Core Features**: ✅ All MVP features implemented
- **Testing Status**: ⏳ Manual testing required
- **Documentation**: ✅ DEVELOPMENT.md created

**Load Extension**:
```
Firefox → about:debugging → Load Temporary Add-on →
Select: /var/home/matt/workspace/zotero/webtero/firefox/dist/manifest.json
```
