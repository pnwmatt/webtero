# Webtero: Product Vision & Feature Set

**Tagline:** _Transform web research from scattered bookmarks into structured knowledge projects_. The missing Project Manager for Zotero.

---

## Executive Summary

Webtero bridges the gap between web browsing and academic research management by treating research as **living projects** rather than isolated saves. Built as a Firefox sidebar extension with direct Zotero Web integration, Webtero automatically captures browsing context, manages versioning, and organizes discoveries into structured collections - all while you read and annotate naturally.

## Core Value Proposition

For researchers, writers, and decision-makers who need to:

- Capture complex research trails without breaking flow
- \* Organize dozens of sources into coherent projects
- \* Revisit research exactly as it was, or monitor for changes
- \* Annotate and categorize on the fly

Webtero provides:

- Session-aware capture: Your browsing graph becomes your research graph
- When you Webtero a page, it is captured using Zotero Connect's standard API, but enhanced with context, versioning, and annotations.
- The sidebar allows for easy "journaling" comments and adding "annotations" which are Zotero native.
- Don't need to highlight text to leave a comment.
- Page % Read is tracked and stored as metadata to the Zotero object.
- Time-travel capability: Can view the live page or back to prior snapshots.
- Project-centric organization: Everything belongs to (zero or many) research goal(s) and comments are made more visible than in the native Zotero interface.
- Frictionless annotation: Highlight → categorize → save in two clicks

---

## Product Architecture

1. **Firefox Sidebar Extension** (Primary Interface)

   - List existing Projects and create new projects. Creating a new project can either attach to an existing Collection/Subcollection in Zotero or create a new Collection/Subcollection.
   - Sidebar shows annotations, comments, and metadata for the current page (including how far you've read down the page).
   - Automatically adds child pages clicked from the parent page
   - Shows annotations and comments inline on pages that link to a Zotero'd page (or Domain)
   - Puts a squigly line under links that are already in Zotero. Hovering over them shows info about the item in Zotero.
   - Highlighting text (or clicking on the page) allows you to highlight or add an annotation in a Zotero compatible way.
   - Data is stored in Local Storage for now but will need to use Zotero object constructs for eventual syncing.

Implementation notes:

- No styling - absolutely minimal css for layout only.
- Should sync with Zotero Web API to get Collections and Subcollections using my OAUTH

3. **Zotero Integration Layer**

   - Projects = Zotero Collections/Subcollections
   - Project Main Page = Standalone Note
   - Uses a Standalone Note for metadata and configuration about the project. Call that "metadata.webtero" and store as a Standalone Note in the Collection.
   - Captured pages = Items with snapshots via the Zotero Connect API
   - Annotations = Child notes with highlights
   - Journal/Comments = Standalone Notes using timestamped appends
