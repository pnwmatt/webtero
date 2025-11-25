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
 * For text nodes, returns path to parent element with text() index
 */
export function getXPath(node: Node): string {
  if (node.nodeType === Node.DOCUMENT_NODE) {
    return '/';
  }

  const parent = node.parentNode;
  if (!parent) {
    return '';
  }

  // For text nodes, get parent path and add text() selector
  if (node.nodeType === Node.TEXT_NODE) {
    const parentPath = getXPath(parent);
    const textNodes = Array.from(parent.childNodes).filter(
      (n) => n.nodeType === Node.TEXT_NODE
    );
    const textIndex = textNodes.indexOf(node as ChildNode) + 1;
    return `${parentPath}/text()[${textIndex}]`;
  }

  const parentPath = getXPath(parent);
  const siblings = Array.from(parent.childNodes).filter(
    (n) => n.nodeType === Node.ELEMENT_NODE && n.nodeName === node.nodeName
  );
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
 * Colors are chosen to meet WCAG 2.0 AA contrast requirements (4.5:1)
 * for black text on the highlight background
 */
export function getColorValue(color: string): string {
  // Pastel colors that provide sufficient contrast with black text
  // All colors tested to have >= 4.5:1 contrast ratio with #000000
  const colors: Record<string, string> = {
    yellow: '#fff59d', // Light yellow - contrast ~19.3:1
    green: '#a5d6a7',  // Light green - contrast ~11.5:1
    blue: '#90caf9',   // Light blue - contrast ~10.4:1
    pink: '#f8bbd9',   // Light pink - contrast ~12.0:1
    purple: '#ce93d8', // Light purple - contrast ~8.1:1
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

/**
 * Calculate MD5 hash of a Uint8Array
 * Simple MD5 implementation for Zotero Web API file uploads
 */
export function md5(data: Uint8Array): string {
  // MD5 helper functions
  function rotateLeft(x: number, n: number): number {
    return (x << n) | (x >>> (32 - n));
  }

  function addUnsigned(x: number, y: number): number {
    return (x + y) >>> 0;
  }

  function F(x: number, y: number, z: number): number {
    return (x & y) | (~x & z);
  }
  function G(x: number, y: number, z: number): number {
    return (x & z) | (y & ~z);
  }
  function H(x: number, y: number, z: number): number {
    return x ^ y ^ z;
  }
  function I(x: number, y: number, z: number): number {
    return y ^ (x | ~z);
  }

  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function wordToHex(value: number): string {
    let result = '';
    for (let i = 0; i < 4; i++) {
      const byte = (value >>> (i * 8)) & 255;
      result += ('0' + byte.toString(16)).slice(-2);
    }
    return result;
  }

  // Pad message
  const msgLen = data.length;
  const padLen = ((msgLen + 8) >>> 6) + 1;
  const paddedLen = padLen << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;

  // Append length in bits
  const bitLen = msgLen * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  // Initialize hash
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  // Process blocks
  for (let i = 0; i < paddedLen; i += 64) {
    const x: number[] = [];
    for (let j = 0; j < 16; j++) {
      x[j] = view.getUint32(i + j * 4, true);
    }

    let aa = a, bb = b, cc = c, dd = d;

    // Round 1
    a = FF(a, b, c, d, x[0], 7, 0xd76aa478);
    d = FF(d, a, b, c, x[1], 12, 0xe8c7b756);
    c = FF(c, d, a, b, x[2], 17, 0x242070db);
    b = FF(b, c, d, a, x[3], 22, 0xc1bdceee);
    a = FF(a, b, c, d, x[4], 7, 0xf57c0faf);
    d = FF(d, a, b, c, x[5], 12, 0x4787c62a);
    c = FF(c, d, a, b, x[6], 17, 0xa8304613);
    b = FF(b, c, d, a, x[7], 22, 0xfd469501);
    a = FF(a, b, c, d, x[8], 7, 0x698098d8);
    d = FF(d, a, b, c, x[9], 12, 0x8b44f7af);
    c = FF(c, d, a, b, x[10], 17, 0xffff5bb1);
    b = FF(b, c, d, a, x[11], 22, 0x895cd7be);
    a = FF(a, b, c, d, x[12], 7, 0x6b901122);
    d = FF(d, a, b, c, x[13], 12, 0xfd987193);
    c = FF(c, d, a, b, x[14], 17, 0xa679438e);
    b = FF(b, c, d, a, x[15], 22, 0x49b40821);

    // Round 2
    a = GG(a, b, c, d, x[1], 5, 0xf61e2562);
    d = GG(d, a, b, c, x[6], 9, 0xc040b340);
    c = GG(c, d, a, b, x[11], 14, 0x265e5a51);
    b = GG(b, c, d, a, x[0], 20, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[5], 5, 0xd62f105d);
    d = GG(d, a, b, c, x[10], 9, 0x02441453);
    c = GG(c, d, a, b, x[15], 14, 0xd8a1e681);
    b = GG(b, c, d, a, x[4], 20, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[9], 5, 0x21e1cde6);
    d = GG(d, a, b, c, x[14], 9, 0xc33707d6);
    c = GG(c, d, a, b, x[3], 14, 0xf4d50d87);
    b = GG(b, c, d, a, x[8], 20, 0x455a14ed);
    a = GG(a, b, c, d, x[13], 5, 0xa9e3e905);
    d = GG(d, a, b, c, x[2], 9, 0xfcefa3f8);
    c = GG(c, d, a, b, x[7], 14, 0x676f02d9);
    b = GG(b, c, d, a, x[12], 20, 0x8d2a4c8a);

    // Round 3
    a = HH(a, b, c, d, x[5], 4, 0xfffa3942);
    d = HH(d, a, b, c, x[8], 11, 0x8771f681);
    c = HH(c, d, a, b, x[11], 16, 0x6d9d6122);
    b = HH(b, c, d, a, x[14], 23, 0xfde5380c);
    a = HH(a, b, c, d, x[1], 4, 0xa4beea44);
    d = HH(d, a, b, c, x[4], 11, 0x4bdecfa9);
    c = HH(c, d, a, b, x[7], 16, 0xf6bb4b60);
    b = HH(b, c, d, a, x[10], 23, 0xbebfbc70);
    a = HH(a, b, c, d, x[13], 4, 0x289b7ec6);
    d = HH(d, a, b, c, x[0], 11, 0xeaa127fa);
    c = HH(c, d, a, b, x[3], 16, 0xd4ef3085);
    b = HH(b, c, d, a, x[6], 23, 0x04881d05);
    a = HH(a, b, c, d, x[9], 4, 0xd9d4d039);
    d = HH(d, a, b, c, x[12], 11, 0xe6db99e5);
    c = HH(c, d, a, b, x[15], 16, 0x1fa27cf8);
    b = HH(b, c, d, a, x[2], 23, 0xc4ac5665);

    // Round 4
    a = II(a, b, c, d, x[0], 6, 0xf4292244);
    d = II(d, a, b, c, x[7], 10, 0x432aff97);
    c = II(c, d, a, b, x[14], 15, 0xab9423a7);
    b = II(b, c, d, a, x[5], 21, 0xfc93a039);
    a = II(a, b, c, d, x[12], 6, 0x655b59c3);
    d = II(d, a, b, c, x[3], 10, 0x8f0ccc92);
    c = II(c, d, a, b, x[10], 15, 0xffeff47d);
    b = II(b, c, d, a, x[1], 21, 0x85845dd1);
    a = II(a, b, c, d, x[8], 6, 0x6fa87e4f);
    d = II(d, a, b, c, x[15], 10, 0xfe2ce6e0);
    c = II(c, d, a, b, x[6], 15, 0xa3014314);
    b = II(b, c, d, a, x[13], 21, 0x4e0811a1);
    a = II(a, b, c, d, x[4], 6, 0xf7537e82);
    d = II(d, a, b, c, x[11], 10, 0xbd3af235);
    c = II(c, d, a, b, x[2], 15, 0x2ad7d2bb);
    b = II(b, c, d, a, x[9], 21, 0xeb86d391);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
}
