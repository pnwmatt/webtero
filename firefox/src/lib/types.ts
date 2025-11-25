// Core data types for Webtero

export type HighlightColor = 'yellow' | 'red' | 'green' | 'blue' | 'purple' | 'magenta' | 'orange' | 'gray';

export interface Project {
  id: string; // Zotero collection key
  name: string; // Collection name
  parentId?: string; // Parent collection (for subcollections)
  itemCount: number; // Number of items
  version: number; // Zotero version for sync
  dateModified?: string; // Last modified date for sorting
}

export interface SavedPage {
  url: string;
  zoteroItemKey: string; // Item key in Zotero
  title: string;
  projects: string[]; // Collection keys
  dateAdded: string;
  snapshot: boolean; // Whether snapshot was saved
  version: number; // Zotero version for sync
}

export interface Annotation {
  id: string;
  pageUrl: string;
  zoteroItemKey: string; // Parent item
  zoteroNoteKey?: string; // Note/annotation in Zotero
  snapshotKey?: string; // Which snapshot this annotation belongs to
  text: string; // Highlighted text
  comment?: string; // User comment
  color: HighlightColor; // Highlight color
  position: {
    // DOM position info (for local highlighting)
    xpath: string;
    offset: number;
    length: number;
    // For Zotero Reader compatibility: unique CSS selector and element-relative text positions
    cssSelector?: string;
    selectorStart?: number;
    selectorEnd?: number;
  };
  created: string;
  notFound?: boolean; // True if annotation couldn't be found on current page
}

export interface Snapshot {
  key: string; // Attachment key in Zotero
  title: string; // "Snapshot" or "Snapshot: <title>"
  dateAdded: string;
  url: string; // URL of the snapshot
}

export interface AuthData {
  apiKey: string;
  userID: string;
  username?: string;
}

/**
 * Tracks a reading session for a saved page
 * Records scroll position over time to calculate read percentage
 */
export interface PageFocusSession {
  id: string;
  itemKey: string; // Zotero item key (not URL for privacy)
  tabId: number; // Browser tab ID
  startTime: string; // ISO timestamp
  endTime?: string; // ISO timestamp when session ended
  readRanges: ReadRange[]; // Scroll ranges that were viewed
}

/**
 * A range of the page that was read (based on scroll position)
 * Stored as percentages of total document height
 */
export interface ReadRange {
  start: number; // 0-100 percentage
  end: number; // 0-100 percentage
}

/**
 * Tracks links between saved pages
 * When user clicks a link from Page A to Page B, both being saved
 */
export interface PageLink {
  id: string;
  sourceItemKey: string; // Item key of the page the link was clicked from
  targetItemKey: string; // Item key of the page that was navigated to
  targetUrl: string; // URL of the target (for matching)
  created: string; // ISO timestamp
}

/**
 * Tracks which tabs have auto-save enabled (after saving a page)
 */
export interface AutoSaveTab {
  tabId: number;
  sourceItemKey: string; // The saved page that triggered auto-save mode
  sourceUrl: string; // URL of the source page
  enabled: boolean;
}

/**
 * An annotation queued for upload while waiting for the page to be saved
 */
export interface OutboxAnnotation {
  id: string;
  pageUrl: string;
  text: string;
  comment?: string;
  color: HighlightColor;
  position: {
    xpath: string;
    offset: number;
    length: number;
    cssSelector?: string;
    selectorStart?: number;
    selectorEnd?: number;
  };
  created: string;
  status: 'pending' | 'saving_page' | 'saving_annotation' | 'failed';
  error?: string;
}

/**
 * User-configurable settings
 */
export interface Settings {
  // Show [wt X%] indicators on links to saved pages
  linkIndicatorsEnabled: boolean;
  // Track and display reading progress
  readingProgressEnabled: boolean;
  // Auto-save pages when clicking links from saved pages
  autoSaveEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  linkIndicatorsEnabled: true,
  readingProgressEnabled: true,
  autoSaveEnabled: true,
};

export interface StorageData {
  auth?: AuthData;
  pages: Record<string, SavedPage>;
  annotations: Record<string, Annotation>;
  projects: Record<string, Project>;
  lastSync?: string;
  // Page focus tracking (keyed by session ID)
  pageFocusSessions: Record<string, PageFocusSession>;
  // Links between saved pages (keyed by link ID)
  pageLinks: Record<string, PageLink>;
  // Tabs with auto-save enabled (keyed by tab ID)
  autoSaveTabs: Record<number, AutoSaveTab>;
  // Annotations queued for upload (keyed by annotation ID)
  outboxAnnotations: Record<string, OutboxAnnotation>;
  // User settings
  settings?: Settings;
}

// Zotero API types
export interface ZoteroCollection {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
  };
  meta?: {
    numCollections?: number;
    numItems?: number;
  };
  data: {
    key: string;
    version: number;
    name: string;
    parentCollection?: string;
    dateModified?: string;
  };
}

export interface ZoteroItem {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
  };
  data: {
    key: string;
    version: number;
    itemType: string;
    title: string;
    url?: string;
    accessDate?: string;
    collections?: string[];
    [key: string]: unknown;
  };
}

export interface ZoteroNote {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
  };
  data: {
    key: string;
    version: number;
    itemType: 'note';
    note: string; // HTML content
    parentItem?: string;
    tags?: Array<{ tag: string }>;
    [key: string]: unknown;
  };
}

export interface ZoteroAnnotation {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
  };
  data: {
    key: string;
    version: number;
    itemType: 'annotation';
    parentItem: string; // Attachment key (snapshot)
    annotationType: 'highlight' | 'underline' | 'note' | 'image';
    annotationText?: string; // The highlighted text
    annotationComment?: string; // User comment
    annotationColor: string; // Hex color like "#ffd400"
    annotationPageLabel?: string;
    annotationSortIndex: string; // Position for sorting
    annotationPosition: string; // JSON position data
    tags?: Array<{ tag: string }>;
    [key: string]: unknown;
  };
}

// Zotero Connector API types
export interface ConnectorPingResponse {
  prefs?: {
    automaticSnapshots?: boolean;
  };
  version?: string;
}

export interface ConnectorActiveCollection {
  id?: string;
  name?: string;
}

// Message types for extension communication
export type MessageType =
  | 'GET_PAGE_DATA'
  | 'SAVE_PAGE'
  | 'CREATE_ANNOTATION'
  | 'UPDATE_ANNOTATION'
  | 'GET_ANNOTATIONS'
  | 'SYNC_PROJECTS'
  | 'HIGHLIGHT_TEXT'
  | 'GET_ALL_SNAPSHOT_ANNOTATIONS'
  | 'INJECT_SINGLEFILE'
  | 'DELETE_ANNOTATION'
  // OAuth messages
  | 'OAUTH_START'
  | 'OAUTH_CALLBACK'
  | 'OAUTH_CHECK_AUTH'
  | 'OAUTH_SIGN_OUT'
  | 'OAUTH_GET_USER_INFO'
  // Page focus and link tracking
  | 'START_FOCUS_SESSION'
  | 'UPDATE_FOCUS_SESSION'
  | 'END_FOCUS_SESSION'
  | 'GET_PAGE_READ_PERCENTAGE'
  | 'SET_READ_PERCENTAGE'
  | 'ENABLE_AUTO_SAVE'
  | 'DISABLE_AUTO_SAVE'
  | 'CHECK_AUTO_SAVE'
  | 'LINK_CLICKED'
  | 'GET_PAGE_LINKS'
  | 'GET_SAVED_URLS'
  // Annotation outbox
  | 'QUEUE_ANNOTATION'
  | 'GET_OUTBOX_ANNOTATIONS'
  | 'RETRY_OUTBOX_ANNOTATION'
  | 'DELETE_OUTBOX_ANNOTATION';

export interface Message {
  type: MessageType;
  data?: unknown;
}

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  settings?: Partial<Settings>;
}
