// Core data types for Webtero

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Project {
  id: string; // Zotero collection key
  name: string; // Collection name
  parentId?: string; // Parent collection (for subcollections)
  itemCount: number; // Number of items
  version: number; // Zotero version for sync
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
    // DOM position info
    xpath: string;
    offset: number;
    length: number;
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
}

export interface StorageData {
  auth?: AuthData;
  pages: Record<string, SavedPage>;
  annotations: Record<string, Annotation>;
  projects: Record<string, Project>;
  lastSync?: string;
}

// Zotero API types
export interface ZoteroCollection {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
  };
  data: {
    key: string;
    version: number;
    name: string;
    parentCollection?: string;
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
  | 'DELETE_ANNOTATION';

export interface Message {
  type: MessageType;
  data?: unknown;
}

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
