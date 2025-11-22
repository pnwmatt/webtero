/**
 * Utility functions
 */

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get XPath for a DOM node
 */
export function getXPath(node: Node): string {
  if (node.nodeType === Node.DOCUMENT_NODE) {
    return '/';
  }

  const parent = node.parentNode;
  if (!parent) {
    return '';
  }

  const parentPath = getXPath(parent);
  const siblings = Array.from(parent.childNodes);
  const index = siblings.indexOf(node as ChildNode) + 1;

  const nodeName = node.nodeName.toLowerCase();
  return `${parentPath}/${nodeName}[${index}]`;
}

/**
 * Get a node from an XPath
 */
export function getNodeFromXPath(xpath: string, doc: Document = document): Node | null {
  try {
    const result = doc.evaluate(
      xpath,
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (error) {
    console.error('Failed to evaluate XPath:', error);
    return null;
  }
}

/**
 * Format date for display
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

/**
 * Normalize URL for comparison
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove hash and trailing slash
    parsed.hash = '';
    let normalized = parsed.toString();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url;
  }
}

/**
 * Get color CSS value from highlight color name
 */
export function getColorValue(color: string): string {
  const colors: Record<string, string> = {
    yellow: '#ffeb3b',
    green: '#4caf50',
    blue: '#2196f3',
    pink: '#e91e63',
    purple: '#9c27b0',
  };
  return colors[color] ?? colors.yellow;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Strip HTML tags
 */
export function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}
