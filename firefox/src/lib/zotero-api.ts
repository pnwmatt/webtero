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
    return auth?.userID ?? '12345'; // Placeholder userID
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
   * Create a webpage item
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
      accessDate: new Date().toISOString(),
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
    return result.successful['0'];
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

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export const zoteroAPI = new ZoteroAPI();
