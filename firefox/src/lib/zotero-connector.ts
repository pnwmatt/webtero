import type { ConnectorPingResponse, ConnectorActiveCollection } from './types';

const CONNECTOR_BASE = 'http://127.0.0.1:23119';

/**
 * Zotero Connector API client for local Zotero instance
 */
class ZoteroConnector {
  /**
   * Check if Zotero is running locally
   */
  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${CONNECTOR_BASE}/connector/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      return response.ok;
    } catch (error) {
      console.log('Zotero connector not available:', error);
      return false;
    }
  }

  /**
   * Get Zotero connector information
   */
  async getInfo(): Promise<ConnectorPingResponse | null> {
    try {
      const response = await fetch(`${CONNECTOR_BASE}/connector/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        return null;
      }

      return response.json();
    } catch (error) {
      console.error('Failed to get connector info:', error);
      return null;
    }
  }

  /**
   * Get the active collection from Zotero
   * Note: This is a placeholder. The actual Zotero Connector API doesn't
   * expose this directly, but we'll use it as a stub for MVP.
   */
  async getActiveCollection(): Promise<ConnectorActiveCollection | null> {
    // TODO: This would need to be implemented via a custom endpoint
    // or by using the Zotero Connector's session state
    // For MVP, we'll return null and fall back to user selection
    return null;
  }

  /**
   * Save a page using the Zotero Connector
   * This leverages Zotero's built-in page saving capabilities
   */
  async savePage(url: string, title: string, html?: string): Promise<boolean> {
    try {
      const response = await fetch(`${CONNECTOR_BASE}/connector/savePage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          title,
          ...(html && { html }),
        }),
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to save page via connector:', error);
      return false;
    }
  }
}

export const zoteroConnector = new ZoteroConnector();
