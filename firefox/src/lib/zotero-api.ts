import type { ZoteroCollection, ZoteroItem, ZoteroNote } from './types';
import { storage } from './storage';

const API_BASE = 'https://api.zotero.org';
const API_VERSION = '3';

/**
 * Zotero Web API client
 */
class ZoteroAPI {
  private async getHeaders(): Promise<HeadersInit> {
    const auth = await storage.getAuth();
    return {
      'Zotero-API-Version': API_VERSION,
      'Content-Type': 'application/json',
      ...(auth?.apiKey && { 'Zotero-API-Key': auth.apiKey }),
    };
  }

  private async getUserID(): Promise<string> {
    const auth = await storage.getAuth();
    return auth?.userID ?? '13937999'; // Placeholder userID
  }

  /**
   * Fetch all collections for the user
   */
  async getCollections(): Promise<ZoteroCollection[]> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const response = await fetch(`${API_BASE}/users/${userID}/collections`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch collections: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a new collection
   */
  async createCollection(name: string, parentId?: string): Promise<ZoteroCollection> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const data = {
      name,
      ...(parentId && { parentCollection: parentId }),
    };

    const response = await fetch(`${API_BASE}/users/${userID}/collections`, {
      method: 'POST',
      headers,
      body: JSON.stringify([data]),
    });

    if (!response.ok) {
      throw new Error(`Failed to create collection: ${response.statusText}`);
    }

    const result = await response.json();
    return result.successful['0'];
  }

  /**
   * Search for an existing item by URL
   * Returns the first matching item or null if none found
   */
  async findItemByUrl(url: string): Promise<ZoteroItem | null> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    // Use the Zotero API search with itemType=webpage and url field
    const params = new URLSearchParams({
      itemType: 'webpage',
      qmode: 'everything',
      q: url,
    });

    const response = await fetch(
      `${API_BASE}/users/${userID}/items?${params.toString()}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to search items: ${response.statusText}`);
    }

    const items: ZoteroItem[] = await response.json();

    // Find exact URL match (search may return partial matches)
    const exactMatch = items.find((item) => item.data.url === url);
    return exactMatch || null;
  }

  /**
   * Get child items (attachments, notes) for a parent item
   */
  async getChildItems(parentItemKey: string): Promise<ZoteroItem[]> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const response = await fetch(
      `${API_BASE}/users/${userID}/items/${parentItemKey}/children`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to get child items: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get snapshot attachments for an item
   * Returns attachment items sorted by dateAdded (newest first)
   */
  async getSnapshots(parentItemKey: string): Promise<ZoteroItem[]> {
    const children = await this.getChildItems(parentItemKey);

    // Filter for HTML attachments (snapshots)
    const snapshots = children.filter(
      (item) =>
        item.data.itemType === 'attachment' &&
        item.data.contentType === 'text/html'
    );

    // Sort by dateAdded, newest first
    snapshots.sort((a, b) => {
      const dateA = new Date(a.data.dateAdded || 0).getTime();
      const dateB = new Date(b.data.dateAdded || 0).getTime();
      return dateB - dateA;
    });

    return snapshots;
  }

  /**
   * Create a webpage item
   * Example response:
   * {
    "successful": {
        "0": {
            "key": "3BPCPE3N",
            "version": 350,
            "library": {
                "type": "user",
                "id": redacted,
                "name": "redacted",
                "links": {
                    "alternate": {
                        "href": "https://www.zotero.org/mm86837161",
                        "type": "text/html"
                    }
                }
            },
            "links": {
                "self": {
                    "href": "https://api.zotero.org/users/13937999/items/3BPCPE3N",
                    "type": "application/json"
                },
                "alternate": {
                    "href": "https://www.zotero.org/mm86837161/items/3BPCPE3N",
                    "type": "text/html"
                }
            },
            "meta": {
                "numChildren": 0
            },
            "data": {
                "key": "3BPCPE3N",
                "version": 350,
                "itemType": "webpage",
                "title": "dev:web_api:v3:start [Zotero Documentation]",
                "creators": [],
                "abstractNote": "",
                "websiteTitle": "",
                "websiteType": "",
                "date": "",
                "shortTitle": "",
                "url": "https://www.zotero.org/support/dev/web_api/v3/start",
                "accessDate": "2025-11-22",
                "language": "",
                "rights": "",
                "extra": "",
                "tags": [],
                "collections": [],
                "relations": {},
                "dateAdded": "2025-11-22T03:59:29Z",
                "dateModified": "2025-11-22T03:59:29Z"
            }
        }
    },
    "success": {
        "0": "3BPCPE3N"
    },
    "unchanged": {},
    "failed": {}
}
   */
  async createWebpageItem(
    url: string,
    title: string,
    collections?: string[]
  ): Promise<ZoteroItem> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const data = {
      itemType: 'webpage',
      title,
      url,
      accessDate: new Date().toISOString().split('T')[0],
      ...(collections && collections.length > 0 && { collections }),
    };

    const response = await fetch(`${API_BASE}/users/${userID}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify([data]),
    });

    if (!response.ok) {
      throw new Error(`Failed to create webpage item: ${response.statusText}`);
    }

    const result = await response.json();
    return result.successful['0'];
  }

  /**
   * Create an annotation as a child note
   */
  async createAnnotation(
    parentItemKey: string,
    text: string,
    comment?: string,
    color?: string
  ): Promise<ZoteroNote> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    // Format note content as HTML
    const noteContent = `
      <p><strong>Highlight:</strong> ${this.escapeHtml(text)}</p>
      ${comment ? `<p><strong>Comment:</strong> ${this.escapeHtml(comment)}</p>` : ''}
      ${color ? `<p><em>Color: ${color}</em></p>` : ''}
    `.trim();

    const data = {
      itemType: 'note',
      parentItem: parentItemKey,
      note: noteContent,
      tags: color ? [{ tag: `highlight-${color}` }] : [],
    };

    const response = await fetch(`${API_BASE}/users/${userID}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify([data]),
    });

    if (!response.ok) {
      throw new Error(`Failed to create annotation: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Create annotation response:', JSON.stringify(result, null, 2));

    // Check for failures
    if (result.failed && Object.keys(result.failed).length > 0) {
      const failedItem = result.failed['0'];
      throw new Error(`Failed to create annotation: ${failedItem?.message || 'Unknown error'}`);
    }

    const note = result.successful?.['0'];
    if (!note) {
      throw new Error('No note returned from API');
    }

    return note;
  }

  /**
   * Get child items (annotations) for a parent item
   */
  async getChildNotes(parentItemKey: string): Promise<ZoteroNote[]> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const response = await fetch(
      `${API_BASE}/users/${userID}/items/${parentItemKey}/children`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch child notes: ${response.statusText}`);
    }

    const items = await response.json();
    return items.filter((item: ZoteroItem | ZoteroNote) => item.data.itemType === 'note');
  }

  /**
   * Get a specific item by key
   */
  async getItem(itemKey: string): Promise<ZoteroItem> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const response = await fetch(
      `${API_BASE}/users/${userID}/items/${itemKey}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch item: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete an item
   */
  async deleteItem(itemKey: string, version: number): Promise<void> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const response = await fetch(
      `${API_BASE}/users/${userID}/items/${itemKey}`,
      {
        method: 'DELETE',
        headers: {
          ...headers,
          'If-Unmodified-Since-Version': version.toString(),
        },
      }
    );

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to delete item: ${response.statusText}`);
    }
  }

  /**
   * Create an attachment item for a snapshot
   */
  async createAttachmentItem(
    parentItemKey: string,
    url: string,
    title: string
  ): Promise<{ key: string; version: number }> {
    const userID = await this.getUserID();
    const headers = await this.getHeaders();

    const data = {
      itemType: 'attachment',
      linkMode: 'imported_url',
      title: title || 'Snapshot',
      url,
      accessDate: new Date().toISOString().split('T')[0],
      parentItem: parentItemKey,
      contentType: 'text/html',
      charset: 'utf-8',
      tags: [],
    };

    const response = await fetch(`${API_BASE}/users/${userID}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify([data]),
    });

    if (!response.ok) {
      throw new Error(`Failed to create attachment item: ${response.statusText}`);
    }

    const result = await response.json();
    const item = result.successful['0'];
    return { key: item.key, version: item.version };
  }

  /**
   * Upload attachment file content
   * This follows the Zotero Web API file upload protocol:
   * 1. Request upload authorization
   * 2. Upload to provided URL
   * 3. Register the upload
   */
  async uploadAttachment(
    attachmentKey: string,
    data: Uint8Array,
    filename: string,
    md5: string
  ): Promise<void> {
    const userID = await this.getUserID();
    const auth = await storage.getAuth();
    if (!auth?.apiKey) {
      throw new Error('No API key available');
    }

    // Step 1: Request upload authorization
    const authParams = new URLSearchParams({
      md5,
      filename,
      filesize: data.byteLength.toString(),
      mtime: Date.now().toString(),
      contentType: 'text/html',
      charset: 'utf-8',
    });

    const authResponse = await fetch(
      `${API_BASE}/users/${userID}/items/${attachmentKey}/file`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'If-None-Match': '*',
          'Zotero-API-Key': auth.apiKey,
          'Zotero-API-Version': API_VERSION,
        },
        body: authParams.toString(),
      }
    );

    if (!authResponse.ok) {
      throw new Error(`Failed to get upload authorization: ${authResponse.statusText}`);
    }

    const authResult = await authResponse.json();

    // If file already exists, no need to upload
    if (authResult.exists) {
      console.log('Snapshot already exists on server');
      return;
    }

    // Step 2: Upload file to the provided URL
    // Combine prefix + data + suffix
    const prefix = new TextEncoder().encode(authResult.prefix);
    const suffix = new TextEncoder().encode(authResult.suffix);
    const uploadData = new Uint8Array(prefix.length + data.length + suffix.length);
    uploadData.set(prefix, 0);
    uploadData.set(data, prefix.length);
    uploadData.set(suffix, prefix.length + data.length);

    const uploadResponse = await fetch(authResult.url, {
      method: 'POST',
      headers: {
        'Content-Type': authResult.contentType,
      },
      body: uploadData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
    }

    // Step 3: Register the upload
    const registerResponse = await fetch(
      `${API_BASE}/users/${userID}/items/${attachmentKey}/file`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'If-None-Match': '*',
          'Zotero-API-Key': auth.apiKey,
          'Zotero-API-Version': API_VERSION,
        },
        body: `upload=${authResult.uploadKey}`,
      }
    );

    if (!registerResponse.ok && registerResponse.status !== 204) {
      throw new Error(`Failed to register upload: ${registerResponse.statusText}`);
    }

    console.log('Snapshot uploaded successfully');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export const zoteroAPI = new ZoteroAPI();
