import type { Annotation, HighlightColor } from '../lib/types';
import { getXPath, getNodeFromXPath, getColorValue } from '../lib/utils';
import { config } from '../lib/config';

const LOG_LEVEL = 0;

if (LOG_LEVEL > 0) console.log('Webtero content script loaded');

// ============================================
// CSS Custom Highlight API Support
// ============================================

// Feature detection for CSS Custom Highlight API (Firefox 132+, Chrome 105+)
const CSS_HIGHLIGHT_SUPPORTED = typeof CSS !== 'undefined' && 'highlights' in CSS;

if (LOG_LEVEL > 0) console.log('Webtero: CSS Custom Highlight API supported:', CSS_HIGHLIGHT_SUPPORTED);

// Registry to track highlights by annotation ID
// Maps annotationId -> { range: Range, color: HighlightColor }
const highlightRegistry = new Map<string, { range: Range; color: HighlightColor }>();

// CSS Highlight objects by color (shared across all annotations of same color)
const cssHighlightsByColor = new Map<HighlightColor, Highlight>();

// Initialize CSS highlights and inject styles
function initCSSHighlights() {
  if (!CSS_HIGHLIGHT_SUPPORTED) return;

  const colors: HighlightColor[] = ['yellow', 'red', 'green', 'blue', 'purple', 'magenta', 'orange', 'gray'];
  const highlights = (CSS as unknown as CSSWithHighlights).highlights;

  // Create a Highlight object for each color
  for (const color of colors) {
    const highlight = new Highlight();
    cssHighlightsByColor.set(color, highlight);
    highlights.set(`webtero-${color}`, highlight);
  }

  // Also create highlights for historical annotations (with different styling)
  for (const color of colors) {
    const highlight = new Highlight();
    cssHighlightsByColor.set(`historical-${color}` as HighlightColor, highlight);
    highlights.set(`webtero-historical-${color}`, highlight);
  }

  // Inject CSS rules for ::highlight() pseudo-element
  const style = document.createElement('style');
  style.id = 'webtero-highlight-styles';
  style.textContent = `
    /* CSS Custom Highlight API styles - colors from Zotero */
    ::highlight(webtero-yellow) { background-color: ${getColorValue('yellow')}; }
    ::highlight(webtero-red) { background-color: ${getColorValue('red')}; }
    ::highlight(webtero-green) { background-color: ${getColorValue('green')}; }
    ::highlight(webtero-blue) { background-color: ${getColorValue('blue')}; }
    ::highlight(webtero-purple) { background-color: ${getColorValue('purple')}; }
    ::highlight(webtero-magenta) { background-color: ${getColorValue('magenta')}; }
    ::highlight(webtero-orange) { background-color: ${getColorValue('orange')}; }
    ::highlight(webtero-gray) { background-color: ${getColorValue('gray')}; }

    /* Historical highlights - same colors but with text decoration for distinction */
    ::highlight(webtero-historical-yellow) { background-color: ${getColorValue('yellow')}; text-decoration: underline dashed; }
    ::highlight(webtero-historical-red) { background-color: ${getColorValue('red')}; text-decoration: underline dashed; }
    ::highlight(webtero-historical-green) { background-color: ${getColorValue('green')}; text-decoration: underline dashed; }
    ::highlight(webtero-historical-blue) { background-color: ${getColorValue('blue')}; text-decoration: underline dashed; }
    ::highlight(webtero-historical-purple) { background-color: ${getColorValue('purple')}; text-decoration: underline dashed; }
    ::highlight(webtero-historical-magenta) { background-color: ${getColorValue('magenta')}; text-decoration: underline dashed; }
    ::highlight(webtero-historical-orange) { background-color: ${getColorValue('orange')}; text-decoration: underline dashed; }
    ::highlight(webtero-historical-gray) { background-color: ${getColorValue('gray')}; text-decoration: underline dashed; }
  `;
  document.head.appendChild(style);
}

// TypeScript types for CSS Highlight API
interface CSSWithHighlights {
  highlights: HighlightRegistry;
}

interface HighlightRegistry {
  set(name: string, highlight: Highlight): void;
  get(name: string): Highlight | undefined;
  delete(name: string): boolean;
  clear(): void;
}

declare class Highlight {
  constructor(...ranges: Range[]);
  add(range: Range): void;
  delete(range: Range): boolean;
  clear(): void;
  has(range: Range): boolean;
  readonly size: number;
  [Symbol.iterator](): IterableIterator<Range>;
}

// Initialize CSS highlights when script loads
if (CSS_HIGHLIGHT_SUPPORTED) {
  initCSSHighlights();
}

// Check for OAuth callback immediately on load
handleOAuthCallback();

let highlightToolbar: { host: HTMLElement; inner: HTMLElement } | null = null;

// ============================================
// Page Focus Tracking
// ============================================

let currentFocusSessionId: string | null = null;
let currentItemKey: string | null = null;
let scrollTrackingInterval: ReturnType<typeof setInterval> | null = null;
let lastScrollPosition = { start: 0, end: 0 };

/**
 * Calculate the current viewport position as a percentage of document height
 */
function getViewportPercentage(): { start: number; end: number } {
  const scrollTop = window.scrollY;
  const viewportHeight = window.innerHeight;
  const documentHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );

  if (documentHeight <= viewportHeight) {
    // Entire document fits in viewport
    return { start: 0, end: 100 };
  }

  const start = (scrollTop / documentHeight) * 100;
  const end = ((scrollTop + viewportHeight) / documentHeight) * 100;

  return {
    start: Math.round(start * 10) / 10,
    end: Math.round(end * 10) / 10,
  };
}

/**
 * Start tracking focus/scroll for a saved page
 */
async function startFocusTracking(itemKey: string) {
  if (LOG_LEVEL > 0) console.log('Webtero: startFocusTracking called for itemKey:', itemKey);

  if (currentFocusSessionId) {
    if (LOG_LEVEL > 0) console.log('Webtero: Already tracking, skipping');
    return;
  }

  currentItemKey = itemKey;

  try {
    // Note: We pass tabId as -1 since content scripts can't access browser.tabs
    // The background script can get the tab ID from the sender if needed
    const response = await browser.runtime.sendMessage({
      type: 'START_FOCUS_SESSION',
      data: {
        itemKey,
        tabId: -1,
      },
    });

    if (response.success) {
      currentFocusSessionId = response.data.sessionId;

      // Record initial position
      const viewport = getViewportPercentage();
      lastScrollPosition = viewport;
      await updateFocusSession(viewport);

      // Start tracking scroll changes
      scrollTrackingInterval = setInterval(async () => {
        const newPosition = getViewportPercentage();
        // Only update if position changed significantly
        if (
          Math.abs(newPosition.start - lastScrollPosition.start) > 1 ||
          Math.abs(newPosition.end - lastScrollPosition.end) > 1
        ) {
          lastScrollPosition = newPosition;
          await updateFocusSession(newPosition);
        }
      }, 2000); // Check every 2 seconds
    }
  } catch (error) {
    console.error('Failed to start focus tracking:', error);
  }
}

/**
 * Update the focus session with new scroll position
 */
async function updateFocusSession(readRange: { start: number; end: number }) {
  if (!currentFocusSessionId) return;

  if (LOG_LEVEL > 0) console.log(`Webtero: Recording scroll position ${readRange.start.toFixed(1)}%-${readRange.end.toFixed(1)}%`);

  try {
    await browser.runtime.sendMessage({
      type: 'UPDATE_FOCUS_SESSION',
      data: {
        sessionId: currentFocusSessionId,
        readRange,
      },
    });
  } catch (error) {
    console.error('Failed to update focus session:', error);
  }
}

/**
 * Stop focus tracking
 */
async function stopFocusTracking() {
  if (scrollTrackingInterval) {
    clearInterval(scrollTrackingInterval);
    scrollTrackingInterval = null;
  }

  if (currentFocusSessionId) {
    try {
      await browser.runtime.sendMessage({
        type: 'END_FOCUS_SESSION',
        data: { sessionId: currentFocusSessionId },
      });
    } catch (error) {
      console.error('Failed to end focus session:', error);
    }
    currentFocusSessionId = null;
    currentItemKey = null;
  }
}

// Stop tracking when page is hidden or unloaded
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopFocusTracking();
  }
});

window.addEventListener('beforeunload', () => {
  stopFocusTracking();
});

// ============================================
// Link Indicators and Auto-Save
// ============================================

interface SavedUrlInfo {
  url: string;
  itemKey: string;
  readPercentage: number;
  annotationColors: string[];
}

let savedUrls: SavedUrlInfo[] = [];
let autoSaveEnabled = false;
let sourceItemKey: string | null = null;
let readingProgressEnabled = true; // Cached setting from background

/**
 * Add indicators to links pointing to saved pages
 */
function addLinkIndicators() {
  if (savedUrls.length === 0) return;

  // Create a map for faster lookup
  const savedUrlMap = new Map<string, SavedUrlInfo>();
  for (const info of savedUrls) {
    savedUrlMap.set(normalizeUrlForComparison(info.url), info);
  }

  // Get current page URL for comparison
  const currentPageUrl = normalizeUrlForComparison(window.location.href);

  // Find all links on the page
  const links = document.querySelectorAll('a[href]');
  links.forEach((link) => {
    const href = (link as HTMLAnchorElement).href;
    if (!href) return;

    // Skip anchor links and links to the current page
    const linkEl = link as HTMLAnchorElement;
    if (linkEl.getAttribute('href')?.startsWith('#')) return;

    const normalizedHref = normalizeUrlForComparison(href);

    // Skip if link points to current page
    if (normalizedHref === currentPageUrl) return;

    const savedInfo = savedUrlMap.get(normalizedHref);

    if (savedInfo) {
      // Add indicator if not already present
      if (!link.querySelector('.webtero-link-indicator')) {
        const indicator = document.createElement('sup');
        indicator.className = 'webtero-link-indicator';
        indicator.style.cssText =
          'font-size: 0.7em; color: #666; margin-left: 2px; font-weight: normal; text-decoration: none; display: inline-flex; align-items: center; vertical-align: super;';

        // Build indicator content with colored blocks using DOM manipulation
        populateLinkIndicator(indicator, savedInfo);

        link.appendChild(indicator);
      } else {
        // Update existing indicator
        const indicator = link.querySelector('.webtero-link-indicator') as HTMLElement;
        indicator.textContent = ''; // Clear existing content
        populateLinkIndicator(indicator, savedInfo);
      }
    }
  });
}

/**
 * Populate a link indicator element with text and color blocks using DOM manipulation
 */
function populateLinkIndicator(indicator: HTMLElement, savedInfo: SavedUrlInfo): void {
  // Only show percentage if reading progress is enabled
  if (readingProgressEnabled) {
    indicator.appendChild(document.createTextNode(`[wt ${savedInfo.readPercentage}%`));
  } else {
    indicator.appendChild(document.createTextNode('[wt'));
  }

  // Add color blocks
  if (savedInfo.annotationColors.length > 0) {
    indicator.appendChild(document.createTextNode(' '));
    for (const color of savedInfo.annotationColors) {
      const span = document.createElement('span');
      span.style.cssText = `display:inline-block;width:3px;height:0.9em;background:${getColorValue(color as HighlightColor)};margin:0 0.5px;border-radius:1px;`;
      indicator.appendChild(span);
    }
  }

  indicator.appendChild(document.createTextNode(']'));
  indicator.title = buildIndicatorTooltip(savedInfo);
}

/**
 * Build tooltip text for link indicator
 */
function buildIndicatorTooltip(info: SavedUrlInfo): string {
  const parts: string[] = [];
  if (readingProgressEnabled) {
    parts.push(`Saved to Webtero - ${info.readPercentage}% read`);
  } else {
    parts.push('Saved to Webtero');
  }
  if (info.annotationColors.length > 0) {
    parts.push(`${info.annotationColors.length} annotation${info.annotationColors.length === 1 ? '' : 's'}`);
  }
  return parts.join('\n');
}

/**
 * Remove all link indicators
 */
function removeLinkIndicators() {
  document.querySelectorAll('.webtero-link-indicator').forEach((el) => el.remove());
}

/**
 * Get all links on the page for sidebar display
 */
function getPageLinksList(): Array<{ url: string; text: string }> {
  const links: Array<{ url: string; text: string }> = [];
  const seenUrls = new Set<string>();

  document.querySelectorAll('a[href]').forEach((link) => {
    const anchor = link as HTMLAnchorElement;
    const href = anchor.href;

    // Skip empty, anchor, and javascript links
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
      return;
    }

    // Skip if we've already seen this URL
    if (seenUrls.has(href)) {
      return;
    }
    seenUrls.add(href);

    // Get link text, falling back to title attribute or empty string
    // Strip any trailing [wt ...] indicator that we may have added
    let text = (anchor.textContent?.trim() || anchor.title || '').slice(0, 100);
    text = text.replace(/\s*\[wt\s+\d+%[^\]]*\]\s*$/, '').trim();

    links.push({ url: href, text });
  });

  return links;
}

/**
 * Normalize URL for comparison (remove trailing slashes, fragments)
 */
function normalizeUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove fragment
    parsed.hash = '';
    // Remove trailing slash from pathname
    if (parsed.pathname.endsWith('/') && parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Fetch saved URLs and add indicators
 */
async function loadSavedUrlsAndIndicators() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_SAVED_URLS' });
    if (response.success && Array.isArray(response.data)) {
      savedUrls = response.data;
      // Extract settings from response
      if (response.settings?.readingProgressEnabled !== undefined) {
        readingProgressEnabled = response.settings.readingProgressEnabled;
      }
      addLinkIndicators();
    }
  } catch (error) {
    console.error('Failed to load saved URLs:', error);
  }
}

/**
 * Handle link clicks for auto-save
 */
function handleLinkClick(event: MouseEvent) {
  if (!autoSaveEnabled || !sourceItemKey) return;

  const target = event.target as HTMLElement;
  const link = target.closest('a[href]') as HTMLAnchorElement;
  if (!link) return;

  const href = link.href;
  if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

  // Notify background script about the link click
  // The actual save happens when the new page loads
  browser.runtime
    .sendMessage({
      type: 'LINK_CLICKED',
      data: {
        tabId: -1, // Will be determined by sender
        targetUrl: href,
      },
    })
    .catch((error) => {
      console.error('Failed to notify link click:', error);
    });
}

/**
 * Enable auto-save mode for this tab
 */
function enableAutoSave(itemKey: string) {
  autoSaveEnabled = true;
  sourceItemKey = itemKey;
  document.addEventListener('click', handleLinkClick, true);
}

/**
 * Disable auto-save mode
 */
function disableAutoSave() {
  autoSaveEnabled = false;
  sourceItemKey = null;
  document.removeEventListener('click', handleLinkClick, true);
}
// Track annotations that couldn't be found on the current page
let notFoundAnnotationIds: Set<string> = new Set();
let highlightsLoaded = false;
let highlightsLoadedPromise: Promise<void> | null = null;
let editToolbar: { host: HTMLElement; inner: HTMLElement } | null = null;
let currentSelection: {
  text: string;
  range: Range;
  xpath: string;
  offset: number;
  // For Zotero Reader compatibility
  cssSelector: string;
  selectorStart: number;
  selectorEnd: number;
} | null = null;

/**
 * Generate a CSS selector uniquely pointing to the element, relative to body.
 * Based on zotero-reader's unique-selector.ts
 */
function getUniqueSelectorContaining(element: Element): string | null {
  const root = element.closest('body');
  if (!root) {
    return null;
  }

  const testSelector = (selector: string) => {
    return root.querySelectorAll(selector).length === 1 && root.querySelector(selector) === element;
  };

  let currentElement: Element | null = element;
  let selector = '';
  while (currentElement && currentElement !== root) {
    const joiner = selector ? ' > ' : '';
    if (currentElement.id) {
      return `#${CSS.escape(currentElement.id)}` + joiner + selector;
    }

    const tagName = currentElement.tagName.toLowerCase();

    const prevSibling = currentElement.previousElementSibling;
    if (prevSibling && prevSibling.id) {
      const prevSiblingIDSelector = `#${CSS.escape(prevSibling.id)} + ${tagName}${joiner}${selector}`;
      if (testSelector(prevSiblingIDSelector)) {
        return prevSiblingIDSelector;
      }
    }

    let childPseudoclass;
    if (currentElement.matches(':only-of-type') || currentElement.matches(':only-child')) {
      childPseudoclass = '';
    } else if (currentElement.matches(':first-child')) {
      childPseudoclass = ':first-child';
    } else if (currentElement.matches(':first-of-type')) {
      childPseudoclass = ':first-of-type';
    } else if (currentElement.matches(':last-child')) {
      childPseudoclass = ':last-child';
    } else if (currentElement.matches(':last-of-type')) {
      childPseudoclass = ':last-of-type';
    } else if (currentElement.parentElement) {
      childPseudoclass = `:nth-child(${Array.from(currentElement.parentElement.children).indexOf(currentElement) + 1})`;
    } else {
      break;
    }

    selector = tagName + childPseudoclass + joiner + selector;

    if (testSelector(selector)) {
      return selector;
    }

    currentElement = currentElement.parentElement;
  }
  return null;
}

/**
 * Calculate text position within an element for a range
 * Returns character offsets across all text nodes within the root element
 * This matches Zotero Reader's TextPositionSelector format
 */
function getTextPositionInElement(range: Range, root: Element): { start: number; end: number } | null {
  const iter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let start: number | undefined;
  let end: number | undefined;

  let node: Node | null;
  while ((node = iter.nextNode())) {
    if (node === range.startContainer) {
      start = pos + range.startOffset;
    }
    if (node === range.endContainer) {
      end = pos + range.endOffset;
    }
    if (node.nodeValue) {
      pos += node.nodeValue.length;
    }
  }

  if (start === undefined || end === undefined) {
    return null;
  }
  return { start, end };
}

/**
 * Find the best container element for the selection
 * Returns the smallest element that contains the entire selection
 */
function getSelectionContainer(range: Range): Element | null {
  let container = range.commonAncestorContainer;
  // If the container is a text node, get its parent element
  if (container.nodeType === Node.TEXT_NODE) {
    container = container.parentElement as Node;
  }
  return container as Element | null;
}
let currentEditHighlight: {
  id: string;
  element: HTMLElement | null;  // null when using CSS Highlight API
  range: Range | null;          // Used for CSS Highlight API
  color: HighlightColor | null; // Current color for CSS highlights
} | null = null;

/**
 * Shared toolbar styles (injected into shadow DOM)
 */
const TOOLBAR_STYLES = `
  :host {
    all: initial;
    position: absolute;
    z-index: 2147483647;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .webtero-toolbar {
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 6px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
    padding: 6px;
    display: flex;
    gap: 4px;
  }
  .webtero-toolbar-content {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .webtero-colors {
    display: flex;
    gap: 4px;
  }
  .webtero-color-btn {
    width: 24px;
    height: 24px;
    border: 2px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: transform 0.1s ease, border-color 0.1s ease;
    box-sizing: border-box;
  }
  .webtero-color-btn:hover {
    transform: scale(1.1);
    border-color: #333;
  }
  .webtero-color-btn.selected {
    border-color: #333;
  }
  .webtero-comment-btn,
  .webtero-delete-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: #f5f5f5;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.1s ease;
  }
  .webtero-comment-btn:hover {
    background: #e0e0e0;
  }
  .webtero-delete-btn:hover {
    background: #ffebee;
  }
`;

/**
 * Create highlight toolbar with Shadow DOM isolation
 */
function createHighlightToolbar(): { host: HTMLElement; inner: HTMLElement } {
  const host = document.createElement('div');
  host.id = 'webtero-highlight-toolbar-host';
  host.style.cssText = 'position: absolute; z-index: 2147483647; display: none;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = TOOLBAR_STYLES;
  shadow.appendChild(style);

  const colors: HighlightColor[] = ['yellow', 'red', 'green', 'blue', 'purple', 'magenta', 'orange', 'gray'];

  const toolbar = document.createElement('div');
  toolbar.className = 'webtero-toolbar';

  // Build toolbar using DOM manipulation instead of innerHTML
  const toolbarContent = document.createElement('div');
  toolbarContent.className = 'webtero-toolbar-content';

  const colorsDiv = document.createElement('div');
  colorsDiv.className = 'webtero-colors';

  for (const color of colors) {
    const btn = document.createElement('button');
    btn.className = 'webtero-color-btn';
    btn.dataset.color = color;
    btn.style.background = getColorValue(color);
    btn.title = color;
    btn.addEventListener('click', () => {
      createHighlight(color);
    });
    colorsDiv.appendChild(btn);
  }

  const commentBtn = document.createElement('button');
  commentBtn.className = 'webtero-comment-btn';
  commentBtn.title = 'Add comment';
  commentBtn.textContent = '💬';
  commentBtn.addEventListener('click', () => {
    const comment = prompt('Add a comment (optional):');
    createHighlight('yellow', comment ?? undefined);
  });

  toolbarContent.appendChild(colorsDiv);
  toolbarContent.appendChild(commentBtn);
  toolbar.appendChild(toolbarContent);

  shadow.appendChild(toolbar);
  document.body.appendChild(host);

  return { host, inner: toolbar };
}

/**
 * Create edit toolbar for existing highlights with Shadow DOM isolation
 */
function createEditToolbar(): { host: HTMLElement; inner: HTMLElement } {
  const host = document.createElement('div');
  host.id = 'webtero-edit-toolbar-host';
  host.style.cssText = 'position: absolute; z-index: 2147483647; display: none;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = TOOLBAR_STYLES;
  shadow.appendChild(style);

  const colors: HighlightColor[] = ['yellow', 'red', 'green', 'blue', 'purple', 'magenta', 'orange', 'gray'];

  const toolbar = document.createElement('div');
  toolbar.className = 'webtero-toolbar';

  // Build toolbar using DOM manipulation instead of innerHTML
  const toolbarContent = document.createElement('div');
  toolbarContent.className = 'webtero-toolbar-content';

  const colorsDiv = document.createElement('div');
  colorsDiv.className = 'webtero-colors';

  for (const color of colors) {
    const btn = document.createElement('button');
    btn.className = 'webtero-color-btn';
    btn.dataset.color = color;
    btn.style.background = getColorValue(color);
    btn.title = `Change to ${color}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateHighlightColor(color);
    });
    colorsDiv.appendChild(btn);
  }

  const commentBtn = document.createElement('button');
  commentBtn.className = 'webtero-comment-btn';
  commentBtn.title = 'Edit comment';
  commentBtn.textContent = '💬';
  commentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    editHighlightComment();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'webtero-delete-btn';
  deleteBtn.title = 'Delete highlight';
  deleteBtn.textContent = '🗑️';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteHighlight();
  });

  toolbarContent.appendChild(colorsDiv);
  toolbarContent.appendChild(commentBtn);
  toolbarContent.appendChild(deleteBtn);
  toolbar.appendChild(toolbarContent);

  shadow.appendChild(toolbar);
  document.body.appendChild(host);

  return { host, inner: toolbar };
}

/**
 * Show edit toolbar for an existing highlight
 */
function showEditToolbar(element: HTMLElement) {
  if (!editToolbar) {
    editToolbar = createEditToolbar();
  }

  const rect = element.getBoundingClientRect();
  editToolbar.host.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
  editToolbar.host.style.top = `${rect.top + window.scrollY - 50}px`;
  editToolbar.host.style.display = 'block';

  // Mark current color as selected
  const currentColor = element.dataset.color;
  editToolbar.inner.querySelectorAll('.webtero-color-btn').forEach((btn: Element) => {
    const btnEl = btn as HTMLElement;
    if (btnEl.dataset.color === currentColor) {
      btnEl.classList.add('selected');
    } else {
      btnEl.classList.remove('selected');
    }
  });
}

/**
 * Hide edit toolbar
 */
function hideEditToolbar() {
  if (editToolbar) {
    editToolbar.host.style.display = 'none';
  }
  currentEditHighlight = null;
}

/**
 * Show edit toolbar at a specific point (for CSS highlights)
 */
function showEditToolbarAtPoint(clientX: number, clientY: number, currentColor: HighlightColor) {
  if (!editToolbar) {
    editToolbar = createEditToolbar();
  }

  editToolbar.host.style.left = `${clientX + window.scrollX}px`;
  editToolbar.host.style.top = `${clientY + window.scrollY - 50}px`;
  editToolbar.host.style.display = 'block';

  // Mark current color as selected
  editToolbar.inner.querySelectorAll('.webtero-color-btn').forEach((btn: Element) => {
    const btnEl = btn as HTMLElement;
    // Handle both regular and historical colors
    const baseColor = (currentColor as string).replace('historical-', '');
    if (btnEl.dataset.color === baseColor) {
      btnEl.classList.add('selected');
    } else {
      btnEl.classList.remove('selected');
    }
  });
}

/**
 * Update highlight color
 */
async function updateHighlightColor(color: HighlightColor) {
  if (!currentEditHighlight) return;

  try {
    const response = await browser.runtime.sendMessage({
      type: 'UPDATE_ANNOTATION',
      data: {
        id: currentEditHighlight.id,
        color,
      },
    });

    if (response.success) {
      // Update visual based on highlight type
      if (CSS_HIGHLIGHT_SUPPORTED && currentEditHighlight.range && currentEditHighlight.color) {
        // CSS Highlight API: move range from old color to new color
        const oldHighlight = cssHighlightsByColor.get(currentEditHighlight.color);
        const newHighlight = cssHighlightsByColor.get(color);
        if (oldHighlight && newHighlight) {
          oldHighlight.delete(currentEditHighlight.range);
          newHighlight.add(currentEditHighlight.range);
          // Update registry
          highlightRegistry.set(currentEditHighlight.id, { range: currentEditHighlight.range, color });
          currentEditHighlight.color = color;
        }
      } else if (currentEditHighlight.element) {
        // DOM-based highlight
        currentEditHighlight.element.style.backgroundColor = getColorValue(color);
        currentEditHighlight.element.dataset.color = color;
      }
      hideEditToolbar();
    } else {
      alert(`Failed to update highlight: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to update highlight:', error);
  }
}

/**
 * Edit highlight comment
 */
async function editHighlightComment() {
  if (!currentEditHighlight) return;

  const comment = prompt('Edit comment:');
  if (comment === null) return; // Cancelled

  try {
    const response = await browser.runtime.sendMessage({
      type: 'UPDATE_ANNOTATION',
      data: {
        id: currentEditHighlight.id,
        comment: comment || undefined,
      },
    });

    if (response.success) {
      hideEditToolbar();
    } else {
      alert(`Failed to update comment: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to update comment:', error);
  }
}

/**
 * Delete highlight
 */
async function deleteHighlight() {
  if (!currentEditHighlight) return;

  if (!confirm('Delete this highlight?')) return;

  try {
    const response = await browser.runtime.sendMessage({
      type: 'DELETE_ANNOTATION',
      data: { id: currentEditHighlight.id },
    });

    if (response.success) {
      // Remove highlight based on type
      if (CSS_HIGHLIGHT_SUPPORTED && currentEditHighlight.range && currentEditHighlight.color) {
        // CSS Highlight API: remove range from highlight
        const highlight = cssHighlightsByColor.get(currentEditHighlight.color);
        if (highlight) {
          highlight.delete(currentEditHighlight.range);
        }
        highlightRegistry.delete(currentEditHighlight.id);
      } else if (currentEditHighlight.element) {
        // DOM-based highlight: unwrap the span
        const element = currentEditHighlight.element;
        const parent = element.parentNode;
        while (element.firstChild) {
          parent?.insertBefore(element.firstChild, element);
        }
        element.remove();
      }
      hideEditToolbar();
    } else {
      alert(`Failed to delete highlight: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to delete highlight:', error);
  }
}

/**
 * Show highlight toolbar
 */
function showHighlightToolbar(x: number, y: number) {
  if (!highlightToolbar) {
    highlightToolbar = createHighlightToolbar();
  }

  highlightToolbar.host.style.left = `${x}px`;
  highlightToolbar.host.style.top = `${y - 50}px`;
  highlightToolbar.host.style.display = 'block';
}

/**
 * Hide highlight toolbar
 */
function hideHighlightToolbar() {
  if (highlightToolbar) {
    highlightToolbar.host.style.display = 'none';
  }
}

/**
 * Handle text selection
 */
function handleTextSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    hideHighlightToolbar();
    currentSelection = null;
    return;
  }

  const text = selection.toString().trim();
  if (text.length === 0) {
    hideHighlightToolbar();
    currentSelection = null;
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // Get XPath and offset (for local highlighting)
  const startNode = range.startContainer;
  const xpath = getXPath(startNode);
  const offset = range.startOffset;

  // Get unique CSS selector and element-relative text position (for Zotero Reader compatibility)
  const container = getSelectionContainer(range);
  if (!container) {
    console.warn('Webtero: Could not find selection container');
    hideHighlightToolbar();
    currentSelection = null;
    return;
  }

  const cssSelector = getUniqueSelectorContaining(container);
  if (!cssSelector) {
    console.warn('Webtero: Could not generate unique CSS selector');
    hideHighlightToolbar();
    currentSelection = null;
    return;
  }

  const textPosition = getTextPositionInElement(range, container);
  if (!textPosition) {
    console.warn('Webtero: Could not calculate text position in element');
    hideHighlightToolbar();
    currentSelection = null;
    return;
  }

  currentSelection = {
    text,
    range: range.cloneRange(),
    xpath,
    offset,
    cssSelector,
    selectorStart: textPosition.start,
    selectorEnd: textPosition.end,
  };

  showHighlightToolbar(
    rect.left + rect.width / 2 + window.scrollX,
    rect.top + window.scrollY
  );
}

/**
 * Create a highlight
 * Uses QUEUE_ANNOTATION which will auto-save the page if needed
 */
async function createHighlight(color: HighlightColor, comment?: string) {
  if (!currentSelection) return;

  try {
    const response = await browser.runtime.sendMessage({
      type: 'QUEUE_ANNOTATION',
      data: {
        url: window.location.href,
        title: document.title,
        text: currentSelection.text,
        comment,
        color,
        position: {
          xpath: currentSelection.xpath,
          offset: currentSelection.offset,
          length: currentSelection.text.length,
          cssSelector: currentSelection.cssSelector,
          selectorStart: currentSelection.selectorStart,
          selectorEnd: currentSelection.selectorEnd,
        },
      },
    });

    if (response.success) {
      const annotationData = response.data.queued
        ? response.data.annotation
        : response.data;

      // Apply visual highlight
      applyVisualHighlight(currentSelection.range, color, annotationData.id);

      // If queued, add a pending indicator
      if (response.data.queued) {
        const highlight = document.querySelector(
          `.webtero-highlight[data-highlight-id="${annotationData.id}"]`
        ) as HTMLElement;
        if (highlight) {
          highlight.classList.add('webtero-highlight-pending');
          highlight.dataset.pending = 'true';
        }
      }

      hideHighlightToolbar();
      window.getSelection()?.removeAllRanges();
      currentSelection = null;
    } else {
      alert(`Failed to create highlight: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to create highlight:', error);
    alert('Failed to create highlight.');
  }
}

/**
 * Apply visual highlight to a range using CSS Custom Highlight API if available,
 * otherwise fall back to DOM manipulation
 */
function applyVisualHighlight(range: Range, color: HighlightColor, id: string) {
  if (CSS_HIGHLIGHT_SUPPORTED) {
    applyVisualHighlightCSS(range, color, id);
  } else {
    applyVisualHighlightDOM(range, color, id);
  }
}

/**
 * Apply highlight using CSS Custom Highlight API (non-destructive)
 */
function applyVisualHighlightCSS(range: Range, color: HighlightColor, id: string) {
  // Clone the range to avoid issues if original range gets invalidated
  const clonedRange = range.cloneRange();

  // Get the Highlight object for this color
  const highlight = cssHighlightsByColor.get(color);
  if (!highlight) {
    console.warn('Webtero: No CSS Highlight object for color:', color);
    // Fall back to DOM approach
    applyVisualHighlightDOM(range, color, id);
    return;
  }

  // Add range to the highlight
  highlight.add(clonedRange);

  // Register in our tracking map
  highlightRegistry.set(id, { range: clonedRange, color });

  if (LOG_LEVEL > 0) console.log(`Webtero: Applied CSS highlight ${id} with color ${color}`);
}

/**
 * Apply highlight using DOM manipulation (fallback for older browsers)
 */
function applyVisualHighlightDOM(range: Range, color: HighlightColor, id: string) {
  const span = document.createElement('span');
  span.className = 'webtero-highlight';
  span.dataset.highlightId = id;
  span.dataset.color = color;
  span.style.backgroundColor = getColorValue(color);
  // No opacity reduction - pastel colors already provide WCAG AA contrast

  try {
    range.surroundContents(span);
  } catch (error) {
    // If surroundContents fails (e.g., range spans multiple elements),
    // use a different approach
    console.warn('Could not apply highlight directly:', error);
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
}

/**
 * Load and apply existing highlights
 */
async function loadExistingHighlights() {
  // Clear the not-found set before reloading
  notFoundAnnotationIds.clear();
  highlightsLoaded = false;

  if (LOG_LEVEL > 0) console.log('Webtero: loadExistingHighlights called for URL:', window.location.href);

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_ANNOTATIONS',
      data: { url: window.location.href },
    });

    if (LOG_LEVEL > 0) console.log('Webtero: GET_ANNOTATIONS response:', response);

    if (response.success && Array.isArray(response.data)) {
      const annotations = response.data as Annotation[];
      if (LOG_LEVEL > 0) console.log(`Webtero: Found ${annotations.length} annotations to apply`);
      annotations.forEach((ann, index) => {
        if (LOG_LEVEL > 0) console.log(`Webtero: [${index + 1}/${annotations.length}] Applying annotation:`, {
          id: ann.id,
          text: ann.text,
          xpath: ann.position?.xpath,
          offset: ann.position?.offset,
          length: ann.position?.length,
        });
        const success = applyStoredHighlight(ann);
        if (!success) {
          notFoundAnnotationIds.add(ann.id);
          if (LOG_LEVEL > 0) console.log(`Webtero: [${index + 1}/${annotations.length}] FAILED to apply annotation:`, ann.id);
        } else {
          if (LOG_LEVEL > 0) console.log(`Webtero: [${index + 1}/${annotations.length}] SUCCESS applied annotation:`, ann.id);
        }
      });
    }
  } catch (error) {
    console.error('Webtero: Failed to load highlights:', error);
  } finally {
    highlightsLoaded = true;
    if (LOG_LEVEL > 0) console.log('Webtero: loadExistingHighlights complete. Not found:', Array.from(notFoundAnnotationIds));
  }
}

/**
 * Retry applying highlights that were previously not found
 * This is useful when the DOM changes or loads dynamically
 */
async function retryNotFoundHighlights(): Promise<{ retriedCount: number; stillNotFound: number }> {
  if (LOG_LEVEL > 0) console.log('Webtero: retryNotFoundHighlights called, notFoundAnnotationIds:', Array.from(notFoundAnnotationIds));

  if (notFoundAnnotationIds.size === 0) {
    if (LOG_LEVEL > 0) console.log('Webtero: No not-found annotations to retry');
    return { retriedCount: 0, stillNotFound: 0 };
  }

  if (LOG_LEVEL > 0) console.log(`Webtero: Retrying ${notFoundAnnotationIds.size} not-found highlights...`);

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_ANNOTATIONS',
      data: { url: window.location.href },
    });

    if (LOG_LEVEL > 0) console.log('Webtero: retryNotFoundHighlights GET_ANNOTATIONS response:', response);

    if (response.success && Array.isArray(response.data)) {
      const annotations = response.data as Annotation[];
      const previouslyNotFoundIds = Array.from(notFoundAnnotationIds);
      const retriedCount = previouslyNotFoundIds.length;

      if (LOG_LEVEL > 0) console.log(`Webtero: retryNotFoundHighlights - ${annotations.length} annotations from server, ${retriedCount} to retry`);

      // Try to apply each previously not-found annotation
      for (const id of previouslyNotFoundIds) {
        const annotation = annotations.find(a => a.id === id);
        if (!annotation) {
          if (LOG_LEVEL > 0) console.log(`Webtero: retryNotFoundHighlights - annotation ${id} not found in server response`);
          continue;
        }

        if (LOG_LEVEL > 0) console.log(`Webtero: retryNotFoundHighlights - retrying annotation:`, {
          id: annotation.id,
          text: annotation.text,
          xpath: annotation.position?.xpath,
          offset: annotation.position?.offset,
          length: annotation.position?.length,
        });

        // Skip if already applied (shouldn't happen, but be safe)
        if (document.querySelector(`.webtero-highlight[data-highlight-id="${id}"]`)) {
          if (LOG_LEVEL > 0) console.log(`Webtero: retryNotFoundHighlights - ${id} already has highlight element, skipping`);
          notFoundAnnotationIds.delete(id);
          continue;
        }

        const success = applyStoredHighlight(annotation);
        if (success) {
          notFoundAnnotationIds.delete(id);
          if (LOG_LEVEL > 0) console.log(`Webtero: retryNotFoundHighlights - SUCCESS applied: ${id}`);
        } else {
          if (LOG_LEVEL > 0) console.log(`Webtero: retryNotFoundHighlights - FAILED to apply: ${id}`);
        }
      }

      const stillNotFound = notFoundAnnotationIds.size;
      if (LOG_LEVEL > 0) console.log(`Webtero: Retry complete. ${retriedCount - stillNotFound}/${retriedCount} highlights applied. ${stillNotFound} still not found.`);

      return { retriedCount, stillNotFound };
    } else {
      if (LOG_LEVEL > 0) console.log('Webtero: retryNotFoundHighlights - response not successful or no data');
    }
  } catch (error) {
    console.error('Failed to retry not-found highlights:', error);
  }

  return { retriedCount: 0, stillNotFound: notFoundAnnotationIds.size };
}

/**
 * Find a text range that matches the given text, starting from a node
 * This handles cases where text spans multiple DOM nodes (e.g., text + <a> + more text)
 */
function findTextRangeFromNode(startNode: Node, offset: number, searchText: string): Range | null {
  // First, try the simple case: text is entirely within the start node
  const textContent = startNode.textContent || '';
  const actualText = textContent.substring(offset, offset + searchText.length);

  if (actualText === searchText) {
    const range = document.createRange();
    range.setStart(startNode, offset);
    range.setEnd(startNode, offset + searchText.length);
    return range;
  }

  // Text spans multiple nodes - we need to walk the DOM
  if (LOG_LEVEL > 0) console.log('Webtero: Text spans multiple nodes, searching...');

  // Get the parent element to search within
  const parentElement = startNode.parentElement;
  if (!parentElement) {
    console.warn('Webtero: No parent element found for start node');
    return null;
  }

  // Walk up a few levels to get a reasonable search container
  let searchContainer: Element = parentElement;
  for (let i = 0; i < 3 && searchContainer.parentElement; i++) {
    searchContainer = searchContainer.parentElement;
  }

  // Use TreeWalker to iterate through text nodes
  const walker = document.createTreeWalker(
    searchContainer,
    NodeFilter.SHOW_TEXT,
    null
  );

  // Find all text nodes and their positions
  const textNodes: { node: Text; start: number; end: number }[] = [];
  let totalLength = 0;
  let node: Text | null = null;

  while ((node = walker.nextNode() as Text | null)) {
    const nodeText = node.textContent || '';
    textNodes.push({
      node,
      start: totalLength,
      end: totalLength + nodeText.length,
    });
    totalLength += nodeText.length;
  }

  // Concatenate all text to search in
  const fullText = textNodes.map(tn => tn.node.textContent || '').join('');

  // Find the search text in the concatenated content
  // Start searching from a position relative to where we expect it
  let searchStartIndex = 0;

  // Try to find the start node to narrow down the search position
  const startNodeIndex = textNodes.findIndex(tn => tn.node === startNode);
  if (startNodeIndex !== -1) {
    searchStartIndex = Math.max(0, textNodes[startNodeIndex].start + offset - 10);
  }

  const foundIndex = fullText.indexOf(searchText, searchStartIndex);
  if (foundIndex === -1) {
    // Try from the beginning as fallback
    const fallbackIndex = fullText.indexOf(searchText);
    if (fallbackIndex === -1) {
      console.warn('Webtero: Could not find text in container:', searchText.substring(0, 50));
      return null;
    }
    return createRangeFromTextNodes(textNodes, fallbackIndex, searchText.length);
  }

  return createRangeFromTextNodes(textNodes, foundIndex, searchText.length);
}

/**
 * Create a Range from text node positions
 */
function createRangeFromTextNodes(
  textNodes: { node: Text; start: number; end: number }[],
  startIndex: number,
  length: number
): Range | null {
  const endIndex = startIndex + length;

  // Find the start node and offset
  let startNodeInfo: { node: Text; offset: number } | null = null;
  let endNodeInfo: { node: Text; offset: number } | null = null;

  for (const tn of textNodes) {
    if (!startNodeInfo && startIndex >= tn.start && startIndex < tn.end) {
      startNodeInfo = { node: tn.node, offset: startIndex - tn.start };
    }
    if (endIndex > tn.start && endIndex <= tn.end) {
      endNodeInfo = { node: tn.node, offset: endIndex - tn.start };
      break;
    }
  }

  if (!startNodeInfo || !endNodeInfo) {
    console.warn('Webtero: Could not determine range boundaries');
    return null;
  }

  const range = document.createRange();
  range.setStart(startNodeInfo.node, startNodeInfo.offset);
  range.setEnd(endNodeInfo.node, endNodeInfo.offset);
  return range;
}

/**
 * Apply a stored highlight from annotation data
 * Returns true if successful, false if the text could not be found
 */
function applyStoredHighlight(annotation: Annotation): boolean {
  try {
    // Fix legacy XPath format: convert #text[n] to text()[n]
    let xpath = annotation.position.xpath;
    if (LOG_LEVEL > 0) console.log('Webtero: applyStoredHighlight - original xpath:', xpath);
    if (xpath.includes('#text[')) {
      xpath = xpath.replace(/#text\[(\d+)\]/g, 'text()[$1]');
      if (LOG_LEVEL > 0) console.log('Webtero: applyStoredHighlight - converted xpath:', xpath);
    }

    const node = getNodeFromXPath(xpath);
    if (LOG_LEVEL > 0) console.log('Webtero: applyStoredHighlight - found node:', node, 'nodeType:', node?.nodeType);
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      console.warn('Webtero: Could not find text node for highlight:', xpath, 'got:', node);
      return false;
    }

    const expectedText = annotation.text;

    // Use the new multi-node search function
    const range = findTextRangeFromNode(node, annotation.position.offset, expectedText);

    if (!range) {
      console.warn('Webtero: Could not find text range for highlight:', {
        expected: expectedText,
        xpath: xpath,
      });
      return false;
    }

    if (LOG_LEVEL > 0) console.log('Webtero: applyStoredHighlight - found range:', {
      startNode: range.startContainer,
      endNode: range.endContainer,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
    });

    applyVisualHighlight(range, annotation.color, annotation.id);
    if (LOG_LEVEL > 0) console.log('Webtero: applyStoredHighlight - successfully applied highlight');
    return true;
  } catch (error) {
    console.error('Webtero: Failed to apply stored highlight:', error);
    return false;
  }
}

// Event listeners
document.addEventListener('mouseup', () => {
  setTimeout(handleTextSelection, 10);
});

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (selection?.isCollapsed) {
    hideHighlightToolbar();
  }
});

/**
 * Find if click position is within any CSS highlight range
 * Returns the annotation ID and range if found
 */
function findCSSHighlightAtPoint(x: number, y: number): { id: string; range: Range; color: HighlightColor } | null {
  // Get the position from coordinates
  const caretPos = document.caretPositionFromPoint?.(x, y) ||
                   (document as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);

  if (!caretPos) return null;

  // Create a collapsed range at the click point
  let clickRange: Range;
  if ('offsetNode' in caretPos) {
    // caretPositionFromPoint result
    clickRange = document.createRange();
    clickRange.setStart(caretPos.offsetNode, caretPos.offset);
    clickRange.setEnd(caretPos.offsetNode, caretPos.offset);
  } else {
    // caretRangeFromPoint result (is already a Range)
    clickRange = caretPos;
  }

  // Check if the click point is within any of our registered highlights
  for (const [id, entry] of highlightRegistry.entries()) {
    const range = entry.range;
    // Check if click is within this range
    // compareBoundaryPoints: -1 = before, 0 = equal, 1 = after
    const startComparison = range.compareBoundaryPoints(Range.START_TO_START, clickRange);
    const endComparison = range.compareBoundaryPoints(Range.END_TO_END, clickRange);

    // Click is within range if: range starts before or at click AND range ends at or after click
    if (startComparison <= 0 && endComparison >= 0) {
      return { id, range: entry.range, color: entry.color };
    }
  }

  return null;
}

// Handle clicks on highlights to show edit toolbar
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const highlightElement = target.closest('.webtero-highlight') as HTMLElement;

  // Check if clicking on a toolbar (check host element contains target)
  if (
    (highlightToolbar && highlightToolbar.host.contains(target)) ||
    (editToolbar && editToolbar.host.contains(target))
  ) {
    return;
  }

  // First check for DOM-based highlights
  if (highlightElement && highlightElement.dataset.highlightId) {
    // Check if the click target or any ancestor (up to highlight) is a link
    const linkElement = target.closest('a[href]');
    if (linkElement && highlightElement.contains(linkElement)) {
      // User is clicking a link within the highlight - let it through
      // Just hide any open toolbars
      hideHighlightToolbar();
      hideEditToolbar();
      return;
    }

    // Also check if the highlight is inside a link
    const parentLink = highlightElement.closest('a[href]');
    if (parentLink) {
      // Highlight is inside a link - let the click through
      hideHighlightToolbar();
      hideEditToolbar();
      return;
    }

    // No link involved - show edit toolbar for DOM highlight
    e.preventDefault();
    e.stopPropagation();
    hideHighlightToolbar();
    currentEditHighlight = {
      id: highlightElement.dataset.highlightId,
      element: highlightElement,
      range: null,
      color: highlightElement.dataset.color as HighlightColor || null,
    };
    showEditToolbar(highlightElement);
    return;
  }

  // Check for CSS-based highlights if API is supported
  if (CSS_HIGHLIGHT_SUPPORTED) {
    const cssHighlight = findCSSHighlightAtPoint(e.clientX, e.clientY);
    if (cssHighlight) {
      // Check if clicking a link
      const linkElement = target.closest('a[href]');
      if (linkElement) {
        hideHighlightToolbar();
        hideEditToolbar();
        return;
      }

      // Show edit toolbar for CSS highlight
      e.preventDefault();
      e.stopPropagation();
      hideHighlightToolbar();
      currentEditHighlight = {
        id: cssHighlight.id,
        element: null,
        range: cssHighlight.range,
        color: cssHighlight.color,
      };
      showEditToolbarAtPoint(e.clientX, e.clientY, cssHighlight.color);
      return;
    }
  }

  // Otherwise, hide toolbars if no text selected
  const selection = window.getSelection();
  if (selection?.isCollapsed) {
    hideHighlightToolbar();
    hideEditToolbar();
  }
});

// Load existing highlights when page loads
if (LOG_LEVEL > 0) console.log('Webtero: Initializing highlights, document.readyState:', document.readyState);
if (document.readyState === 'loading') {
  if (LOG_LEVEL > 0) console.log('Webtero: Document still loading, waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', () => {
    if (LOG_LEVEL > 0) console.log('Webtero: DOMContentLoaded fired, calling loadExistingHighlights');
    highlightsLoadedPromise = loadExistingHighlights();
    // Retry after a short delay to handle dynamic content
    setTimeout(retryNotFoundHighlights, 1000);
  });
} else {
  if (LOG_LEVEL > 0) console.log('Webtero: Document already loaded, calling loadExistingHighlights immediately');
  highlightsLoadedPromise = loadExistingHighlights();
  // Retry after a short delay to handle dynamic content
  setTimeout(retryNotFoundHighlights, 1000);
}

// === SINGLEFILE INTEGRATION ===
// SingleFile configuration (based on zotero-browser-extension)
const SINGLEFILE_CONFIG = {
  removeHiddenElements: true,
  removeUnusedStyles: true,
  removeUnusedFonts: true,
  removeFrames: false,
  removeImports: true,
  removeScripts: true,
  compressHTML: false,
  compressCSS: false,
  loadDeferredImages: true,
  loadDeferredImagesMaxIdleTime: 1500,
  loadDeferredImagesBlockCookies: false,
  loadDeferredImagesBlockStorage: false,
  loadDeferredImagesKeepZoomLevel: false,
  filenameTemplate: '{page-title}',
  infobarTemplate: '',
  includeInfobar: false,
  confirmInfobarContent: false,
  autoClose: false,
  confirmFilename: false,
  filenameConflictAction: 'uniquify',
  filenameMaxLength: 192,
  filenameMaxLengthUnit: 'bytes',
  filenameReplacedCharacters: ['~', '+', '\\\\', '?', '%', '*', ':', '|', '"', '<', '>', '\x00-\x1f', '\x7F'],
  filenameReplacementCharacter: '_',
  maxResourceSize: 10,
  maxResourceSizeEnabled: false,
  removeAlternativeFonts: true,
  removeAlternativeMedias: true,
  removeAlternativeImages: true,
  groupDuplicateImages: true,
  saveRawPage: false,
  insertTextBody: false,
  resolveFragmentIdentifierURLs: false,
  insertEmbeddedImage: false,
  preventAppendedData: false,
  selfExtractingArchive: false,
  extractDataFromPage: true,
  insertCanonicalLink: true,
  insertMetaNoIndex: false,
  insertMetaCSP: true,
  blockMixedContent: false,
  saveOriginalURLs: false,
  replaceEmptyTitle: false,
  includeBOM: false,
  createRootDirectory: false,
};

let singleFileInjected = false;

/**
 * Inject SingleFile scripts into the page context
 * We inject into page context because that's where SingleFile needs to run
 * and use custom events to communicate the result back
 */
async function injectSingleFileScripts(): Promise<void> {
  if (singleFileInjected) return;

  const scripts = [
    'lib/singlefile/single-file-hooks-frames.js',
    'lib/singlefile/single-file-bootstrap.js',
    'lib/singlefile/single-file.js',
  ];

  for (const src of scripts) {
    const scriptElement = document.createElement('script');
    scriptElement.src = browser.runtime.getURL(src);
    scriptElement.async = false;

    await new Promise<void>((resolve, reject) => {
      scriptElement.onload = () => resolve();
      scriptElement.onerror = () => reject(new Error(`Failed to load ${src}`));
      const insertElement = document.head || document.documentElement || document;
      insertElement.appendChild(scriptElement);
    });

    scriptElement.remove();
  }

  singleFileInjected = true;
}

/**
 * Capture the current page HTML using SingleFile
 * SingleFile runs in the page context, so we use custom events to communicate
 */
async function capturePageHTML(): Promise<string> {
  if (LOG_LEVEL > 0) console.log('Webtero: Starting page capture with SingleFile...');

  try {
    // Inject SingleFile scripts into page context
    await injectSingleFileScripts();

    // Wait for SingleFile to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Inject a capture script that runs in the page context and sends result via custom event
    const captureResult = await new Promise<string>((resolve, reject) => {
      const responseHandler = (event: CustomEvent) => {
        document.removeEventListener('webtero-singlefile-result', responseHandler as EventListener);
        if (event.detail.error) {
          reject(new Error(event.detail.error));
        } else {
          resolve(event.detail.content);
        }
      };

      document.addEventListener('webtero-singlefile-result', responseHandler as EventListener);

      // Inject script to run SingleFile capture in page context
      const captureScript = document.createElement('script');
      captureScript.textContent = `
        (async function() {
          try {
            if (typeof singlefile === 'undefined') {
              throw new Error('SingleFile not available');
            }
            const config = ${JSON.stringify(SINGLEFILE_CONFIG)};
            const pageData = await singlefile.getPageData(config);
            document.dispatchEvent(new CustomEvent('webtero-singlefile-result', {
              detail: { content: pageData.content }
            }));
          } catch (error) {
            document.dispatchEvent(new CustomEvent('webtero-singlefile-result', {
              detail: { error: error.message }
            }));
          }
        })();
      `;
      document.documentElement.appendChild(captureScript);
      captureScript.remove();

      // Timeout after 30 seconds
      setTimeout(() => {
        document.removeEventListener('webtero-singlefile-result', responseHandler as EventListener);
        reject(new Error('SingleFile capture timed out'));
      }, 30000);
    });

    if (LOG_LEVEL > 0) console.log('Webtero: Page capture complete');
    return captureResult;
  } catch (error) {
    console.error('Webtero: SingleFile capture failed, falling back to basic capture:', error);
    // Fallback to basic capture if SingleFile fails
    return capturePageHTMLBasic();
  }
}

/**
 * Basic page capture fallback (without CSS inlining)
 */
function capturePageHTMLBasic(): string {
  const docClone = document.cloneNode(true) as Document;

  // Remove webtero-specific elements
  const webteroElements = docClone.querySelectorAll(
    '#webtero-highlight-toolbar, #webtero-edit-toolbar, .webtero-highlight'
  );
  webteroElements.forEach((el) => {
    if (el.classList.contains('webtero-highlight')) {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent?.insertBefore(el.firstChild, el);
      }
    }
    el.remove();
  });

  // Add base tag for relative URLs
  const baseTag = docClone.createElement('base');
  baseTag.href = window.location.href;
  docClone.head?.insertBefore(baseTag, docClone.head.firstChild);

  return '<!DOCTYPE html>\n' + docClone.documentElement.outerHTML;
}

/**
 * Apply historical annotations from snapshots to the current page
 * Returns the IDs of annotations that could not be found on the current page
 */
function applyHistoricalAnnotations(annotations: Annotation[]): { notFoundIds: string[] } {
  const notFoundIds: string[] = [];

  for (const annotation of annotations) {
    // Skip if already applied - check both CSS registry and DOM
    if (highlightRegistry.has(annotation.id) ||
        document.querySelector(`.webtero-highlight[data-highlight-id="${annotation.id}"]`)) {
      continue;
    }

    const applied = applyStoredHighlightWithCheck(annotation);
    if (!applied) {
      notFoundIds.push(annotation.id);
    }
  }

  return { notFoundIds };
}

/**
 * Apply a stored highlight from annotation data (historical)
 * Returns true if successful, false if the text could not be found
 */
function applyStoredHighlightWithCheck(annotation: Annotation): boolean {
  try {
    // Fix legacy XPath format: convert #text[n] to text()[n]
    let xpath = annotation.position.xpath;
    if (xpath.includes('#text[')) {
      xpath = xpath.replace(/#text\[(\d+)\]/g, 'text()[$1]');
    }

    const node = getNodeFromXPath(xpath);
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      console.warn('Could not find text node for historical highlight:', xpath);
      return false;
    }

    const expectedText = annotation.text;

    // Use the multi-node search function (handles text spanning multiple nodes)
    const range = findTextRangeFromNode(node, annotation.position.offset, expectedText);

    if (!range) {
      console.warn('Could not find text range for historical highlight:', {
        expected: expectedText,
        xpath: xpath,
      });
      return false;
    }

    // Apply highlight - use CSS API if available
    if (CSS_HIGHLIGHT_SUPPORTED) {
      applyHistoricalHighlightCSS(range, annotation.color, annotation.id);
    } else {
      applyHistoricalHighlightDOM(range, annotation.color, annotation.id);
    }

    return true;
  } catch (error) {
    console.error('Failed to apply historical highlight:', error);
    return false;
  }
}

/**
 * Apply historical highlight using CSS Custom Highlight API
 */
function applyHistoricalHighlightCSS(range: Range, color: HighlightColor, id: string) {
  const clonedRange = range.cloneRange();
  const historicalColor = `historical-${color}` as HighlightColor;

  const highlight = cssHighlightsByColor.get(historicalColor);
  if (!highlight) {
    console.warn('Webtero: No CSS Highlight object for historical color:', historicalColor);
    applyHistoricalHighlightDOM(range, color, id);
    return;
  }

  highlight.add(clonedRange);
  highlightRegistry.set(id, { range: clonedRange, color: historicalColor });

  if (LOG_LEVEL > 0) console.log(`Webtero: Applied historical CSS highlight ${id} with color ${color}`);
}

/**
 * Apply historical highlight using DOM manipulation (fallback)
 */
function applyHistoricalHighlightDOM(range: Range, color: HighlightColor, id: string) {
  const span = document.createElement('span');
  span.className = 'webtero-highlight webtero-historical-highlight';
  span.dataset.highlightId = id;
  span.dataset.color = color;
  span.dataset.historical = 'true';
  span.style.backgroundColor = getColorValue(color);
  span.style.borderBottom = '2px dashed currentColor'; // Visual distinction without reducing contrast

  try {
    range.surroundContents(span);
  } catch (error) {
    console.warn('Could not apply historical highlight directly:', error);
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
}

/**
 * Remove all historical annotations from the page
 */
function removeHistoricalAnnotations() {
  if (CSS_HIGHLIGHT_SUPPORTED) {
    // Remove from CSS registry
    const idsToRemove: string[] = [];
    for (const [id, entry] of highlightRegistry.entries()) {
      if ((entry.color as string).startsWith('historical-')) {
        const highlight = cssHighlightsByColor.get(entry.color);
        if (highlight) {
          highlight.delete(entry.range);
        }
        idsToRemove.push(id);
      }
    }
    for (const id of idsToRemove) {
      highlightRegistry.delete(id);
    }
  }

  // Also clean up any DOM-based historical highlights (fallback or mixed mode)
  const historicalHighlights = document.querySelectorAll('.webtero-historical-highlight');
  historicalHighlights.forEach((el) => {
    const parent = el.parentNode;
    while (el.firstChild) {
      parent?.insertBefore(el.firstChild, el);
    }
    el.remove();
  });

  // Normalize text nodes that may have been split
  document.body.normalize();
}

// Listen for messages from sidebar and background script
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'CAPTURE_PAGE_HTML') {
    // Return a promise for async capture
    return capturePageHTML()
      .then((html) => ({ success: true, data: html }))
      .catch((error) => {
        console.error('Failed to capture page HTML:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      });
  }

  if (message.type === 'SCROLL_TO_HIGHLIGHT') {
    const { id } = message.data;
    scrollToHighlight(id);
    return Promise.resolve({ success: true });
  }

  if (message.type === 'APPLY_HISTORICAL_ANNOTATIONS') {
    const { annotations } = message.data;
    const result = applyHistoricalAnnotations(annotations);
    return Promise.resolve({ success: true, data: result });
  }

  if (message.type === 'REMOVE_HISTORICAL_ANNOTATIONS') {
    removeHistoricalAnnotations();
    return Promise.resolve({ success: true });
  }

  if (message.type === 'GET_NOT_FOUND_ANNOTATIONS') {
    // Wait for highlights to finish loading before returning not-found list
    const waitForHighlights = async () => {
      if (highlightsLoadedPromise) {
        await highlightsLoadedPromise;
      }
      return {
        success: true,
        data: { notFoundIds: Array.from(notFoundAnnotationIds) },
      };
    };
    return waitForHighlights();
  }

  if (message.type === 'RETRY_NOT_FOUND_HIGHLIGHTS') {
    // Retry applying highlights that were previously not found
    return retryNotFoundHighlights().then((result) => ({
      success: true,
      data: {
        retriedCount: result.retriedCount,
        stillNotFound: result.stillNotFound,
        notFoundIds: Array.from(notFoundAnnotationIds),
      },
    }));
  }

  // Focus tracking messages
  if (message.type === 'START_FOCUS_TRACKING') {
    const { itemKey } = message.data;
    startFocusTracking(itemKey);
    return Promise.resolve({ success: true });
  }

  if (message.type === 'STOP_FOCUS_TRACKING') {
    stopFocusTracking();
    return Promise.resolve({ success: true });
  }

  // Link indicator messages
  if (message.type === 'ENABLE_LINK_INDICATORS') {
    loadSavedUrlsAndIndicators();
    return Promise.resolve({ success: true });
  }

  if (message.type === 'DISABLE_LINK_INDICATORS') {
    removeLinkIndicators();
    return Promise.resolve({ success: true });
  }

  if (message.type === 'ENABLE_AUTO_SAVE_MODE') {
    const { itemKey } = message.data;
    enableAutoSave(itemKey);
    return Promise.resolve({ success: true });
  }

  if (message.type === 'DISABLE_AUTO_SAVE_MODE') {
    disableAutoSave();
    return Promise.resolve({ success: true });
  }

  if (message.type === 'REFRESH_LINK_INDICATORS') {
    loadSavedUrlsAndIndicators();
    return Promise.resolve({ success: true });
  }

  // Get all links on the page for sidebar display
  if (message.type === 'GET_PAGE_LINKS_LIST') {
    const links = getPageLinksList();
    return Promise.resolve({ success: true, data: links });
  }

  // Outbox annotation updates
  if (message.type === 'OUTBOX_ANNOTATION_COMPLETED') {
    const { id, annotation } = message.data;

    // Handle CSS-based highlights
    if (CSS_HIGHLIGHT_SUPPORTED && highlightRegistry.has(id)) {
      // Update the registry with the new annotation ID
      if (annotation?.id && annotation.id !== id) {
        const entry = highlightRegistry.get(id);
        if (entry) {
          highlightRegistry.delete(id);
          highlightRegistry.set(annotation.id, entry);
        }
      }
    }

    // Handle DOM-based highlights
    const highlight = document.querySelector(
      `.webtero-highlight[data-highlight-id="${id}"]`
    ) as HTMLElement;
    if (highlight) {
      highlight.classList.remove('webtero-highlight-pending');
      delete highlight.dataset.pending;
      // Update the highlight ID to the final annotation ID
      if (annotation?.id) {
        highlight.dataset.highlightId = annotation.id;
      }
    }
    return Promise.resolve({ success: true });
  }

  if (message.type === 'OUTBOX_ANNOTATION_UPDATED') {
    const annotation = message.data;
    // CSS highlights don't have visual failed state, but DOM highlights do
    const highlight = document.querySelector(
      `.webtero-highlight[data-highlight-id="${annotation.id}"]`
    ) as HTMLElement;
    if (highlight && annotation.status === 'failed') {
      highlight.classList.add('webtero-highlight-failed');
      highlight.title = `Failed: ${annotation.error || 'Unknown error'}`;
    }
    return Promise.resolve({ success: true });
  }

  return undefined;
});

/**
 * Scroll to a highlight and briefly flash it
 */
function scrollToHighlight(id: string) {
  // First check DOM-based highlights
  const domHighlight = document.querySelector(
    `.webtero-highlight[data-highlight-id="${id}"]`
  ) as HTMLElement;

  if (domHighlight) {
    scrollToAndFlashDOMHighlight(domHighlight);
    return;
  }

  // Check CSS-based highlights
  if (CSS_HIGHLIGHT_SUPPORTED) {
    const entry = highlightRegistry.get(id);
    if (entry) {
      scrollToAndFlashCSSHighlight(entry.range, entry.color);
      return;
    }
  }

  console.warn('Highlight not found:', id);
}

/**
 * Scroll to and flash a DOM-based highlight
 */
function scrollToAndFlashDOMHighlight(highlight: HTMLElement) {
  // Scroll into view
  highlight.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });

  // Flash the highlight to draw attention using outline (maintains WCAG contrast)
  highlight.style.transition = 'outline 0.15s ease-in-out';

  // Flash sequence using outline instead of opacity
  const flash = () => {
    highlight.style.outline = '3px solid #1976d2';
    setTimeout(() => {
      highlight.style.outline = 'none';
      setTimeout(() => {
        highlight.style.outline = '3px solid #1976d2';
        setTimeout(() => {
          highlight.style.outline = '';
          highlight.style.transition = '';
        }, 150);
      }, 150);
    }, 150);
  };

  // Start flash after scroll completes
  setTimeout(flash, 300);
}

/**
 * Scroll to and flash a CSS-based highlight
 */
function scrollToAndFlashCSSHighlight(range: Range, color: HighlightColor) {
  // Get the bounding rect of the range to scroll to
  const rects = range.getClientRects();
  if (rects.length === 0) {
    console.warn('CSS highlight range has no rects');
    return;
  }

  // Scroll to the first rect
  const firstRect = rects[0];
  const scrollY = window.scrollY + firstRect.top - window.innerHeight / 2;
  window.scrollTo({
    top: scrollY,
    behavior: 'smooth',
  });

  // For CSS highlights, we can flash by temporarily removing and re-adding to highlight
  // Or use Selection API to visually indicate
  const highlight = cssHighlightsByColor.get(color);
  if (!highlight) return;

  // Flash by briefly removing from highlight and re-adding
  const flash = () => {
    highlight.delete(range);
    setTimeout(() => {
      highlight.add(range);
      setTimeout(() => {
        highlight.delete(range);
        setTimeout(() => {
          highlight.add(range);
        }, 150);
      }, 150);
    }, 150);
  };

  // Start flash after scroll completes
  setTimeout(flash, 300);
}

/**
 * Show OAuth result page using DOM manipulation (avoids innerHTML for security)
 */
function showOAuthResultPage(success: boolean, title: string, message: string): void {
  // Clear the body
  document.body.textContent = '';

  const container = document.createElement('div');
  container.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: system-ui, sans-serif;';

  const h1 = document.createElement('h1');
  h1.style.cssText = `color: ${success ? '#4caf50' : '#c62828'}; margin-bottom: 1rem;`;
  h1.textContent = title;

  const p1 = document.createElement('p');
  p1.style.cssText = 'color: #666;';
  p1.textContent = message;

  const p2 = document.createElement('p');
  p2.style.cssText = 'color: #999; font-size: 0.875rem; margin-top: 2rem;';
  p2.textContent = success ? 'This window will close automatically...' : 'Please close this window and try again.';

  container.appendChild(h1);
  container.appendChild(p1);
  container.appendChild(p2);
  document.body.appendChild(container);
}

/**
 * Handle OAuth callback URL detection
 * When Zotero redirects to the callback URL after authorization,
 * this function detects it and sends the OAuth parameters to the background script
 */
function handleOAuthCallback() {
  // Only check if OAuth is enabled
  if (!config.features.oauthEnabled) {
    return;
  }

  const currentUrl = window.location.href;
  const callbackUrl = config.oauth.callbackUrl;

  // Check if current URL is the OAuth callback
  if (currentUrl.startsWith(callbackUrl + '?')) {
    if (LOG_LEVEL > 0) console.log('Webtero: OAuth callback detected');

    // Extract query string
    const queryString = currentUrl.substring(callbackUrl.length + 1);

    // Send to background script
    browser.runtime
      .sendMessage({
        type: 'OAUTH_CALLBACK',
        data: { queryString },
      })
      .then((response) => {
        if (response?.success) {
          if (LOG_LEVEL > 0) console.log('Webtero: OAuth callback processed successfully');
          // Show success message on the page using DOM manipulation
          showOAuthResultPage(true, 'Authorization Successful', 'You can close this window and return to Webtero.');
          // Try to close the window after a short delay
          setTimeout(() => {
            window.close();
          }, 2000);
        } else {
          console.error('Webtero: OAuth callback failed:', response?.error);
          // Show error message on the page using DOM manipulation
          showOAuthResultPage(false, 'Authorization Failed', response?.error || 'Unknown error occurred');
        }
      })
      .catch((error) => {
        console.error('Webtero: Failed to send OAuth callback:', error);
      });
  }
}
