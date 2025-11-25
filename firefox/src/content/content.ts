import type { Annotation, HighlightColor } from '../lib/types';
import { getXPath, getNodeFromXPath, getColorValue } from '../lib/utils';
import { config } from '../lib/config';

console.log('Webtero content script loaded');

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
  console.log('Webtero: startFocusTracking called for itemKey:', itemKey);

  if (currentFocusSessionId) {
    console.log('Webtero: Already tracking, skipping');
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

  console.log(`Webtero: Recording scroll position ${readRange.start.toFixed(1)}%-${readRange.end.toFixed(1)}%`);

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

        // Build indicator content with colored blocks
        const colorBlocks = buildAnnotationColorBlocks(savedInfo.annotationColors);
        indicator.innerHTML = `[wt ${savedInfo.readPercentage}% ${colorBlocks}]`;
        indicator.title = buildIndicatorTooltip(savedInfo);

        link.appendChild(indicator);
      } else {
        // Update existing indicator
        const indicator = link.querySelector('.webtero-link-indicator') as HTMLElement;
        const colorBlocks = buildAnnotationColorBlocks(savedInfo.annotationColors);
        indicator.innerHTML = `[wt ${savedInfo.readPercentage}% ${colorBlocks}]`;
        indicator.title = buildIndicatorTooltip(savedInfo);
      }
    }
  });
}

/**
 * Build HTML for annotation color blocks
 */
function buildAnnotationColorBlocks(colors: string[]): string {
  if (colors.length === 0) return ' ';

  // Create small colored blocks for each annotation
  const blocks = colors.map((color) => {
    const bgColor = getColorValue(color as HighlightColor);
    return `<span style="display:inline-block;width:3px;height:0.9em;background:${bgColor};margin:0 0.5px;border-radius:1px;"></span>`;
  }).join('');

  return ` ${blocks} `;
}

/**
 * Build tooltip text for link indicator
 */
function buildIndicatorTooltip(info: SavedUrlInfo): string {
  const parts = [`Saved to Webtero - ${info.readPercentage}% read`];
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
} | null = null;
let currentEditHighlight: {
  id: string;
  element: HTMLElement;
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

  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

  const toolbar = document.createElement('div');
  toolbar.className = 'webtero-toolbar';
  toolbar.innerHTML = `
    <div class="webtero-toolbar-content">
      <div class="webtero-colors">
        ${colors
      .map(
        (color) =>
          `<button class="webtero-color-btn" data-color="${color}" style="background: ${getColorValue(color)}" title="${color}"></button>`
      )
      .join('')}
      </div>
      <button class="webtero-comment-btn" title="Add comment">💬</button>
    </div>
  `;

  // Add event listeners
  toolbar.querySelectorAll('.webtero-color-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const color = (e.target as HTMLElement).dataset.color as HighlightColor;
      createHighlight(color);
    });
  });

  toolbar.querySelector('.webtero-comment-btn')?.addEventListener('click', () => {
    const comment = prompt('Add a comment (optional):');
    createHighlight('yellow', comment ?? undefined);
  });

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

  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

  const toolbar = document.createElement('div');
  toolbar.className = 'webtero-toolbar';
  toolbar.innerHTML = `
    <div class="webtero-toolbar-content">
      <div class="webtero-colors">
        ${colors
      .map(
        (color) =>
          `<button class="webtero-color-btn" data-color="${color}" style="background: ${getColorValue(color)}" title="Change to ${color}"></button>`
      )
      .join('')}
      </div>
      <button class="webtero-comment-btn" title="Edit comment">💬</button>
      <button class="webtero-delete-btn" title="Delete highlight">🗑️</button>
    </div>
  `;

  // Add event listeners for color change
  toolbar.querySelectorAll('.webtero-color-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = (e.target as HTMLElement).dataset.color as HighlightColor;
      updateHighlightColor(color);
    });
  });

  // Edit comment
  toolbar.querySelector('.webtero-comment-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    editHighlightComment();
  });

  // Delete highlight
  toolbar.querySelector('.webtero-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteHighlight();
  });

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
      // Update visual
      currentEditHighlight.element.style.backgroundColor = getColorValue(color);
      currentEditHighlight.element.dataset.color = color;
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
      // Remove from DOM
      const element = currentEditHighlight.element;
      const parent = element.parentNode;
      while (element.firstChild) {
        parent?.insertBefore(element.firstChild, element);
      }
      element.remove();
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

  // Get XPath and offset
  const startNode = range.startContainer;
  const xpath = getXPath(startNode);
  const offset = range.startOffset;

  currentSelection = {
    text,
    range: range.cloneRange(),
    xpath,
    offset,
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
 * Apply visual highlight to a range
 */
function applyVisualHighlight(range: Range, color: HighlightColor, id: string) {
  const span = document.createElement('span');
  span.className = 'webtero-highlight';
  span.dataset.highlightId = id;
  span.dataset.color = color;
  span.style.backgroundColor = getColorValue(color);
  span.style.opacity = '0.4';

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

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_ANNOTATIONS',
      data: { url: window.location.href },
    });

    if (response.success && Array.isArray(response.data)) {
      const annotations = response.data as Annotation[];
      annotations.forEach((ann) => {
        const success = applyStoredHighlight(ann);
        if (!success) {
          notFoundAnnotationIds.add(ann.id);
        }
      });
    }
  } catch (error) {
    console.error('Failed to load highlights:', error);
  } finally {
    highlightsLoaded = true;
  }
}

/**
 * Apply a stored highlight from annotation data
 * Returns true if successful, false if the text could not be found
 */
function applyStoredHighlight(annotation: Annotation): boolean {
  try {
    // Fix legacy XPath format: convert #text[n] to text()[n]
    let xpath = annotation.position.xpath;
    if (xpath.includes('#text[')) {
      xpath = xpath.replace(/#text\[(\d+)\]/g, 'text()[$1]');
    }

    const node = getNodeFromXPath(xpath);
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      console.warn('Could not find text node for highlight:', xpath);
      return false;
    }

    // Check if the text content still matches
    const textContent = node.textContent || '';
    const expectedText = annotation.text;
    const actualText = textContent.substring(
      annotation.position.offset,
      annotation.position.offset + annotation.position.length
    );

    if (actualText !== expectedText) {
      console.warn('Text mismatch for highlight:', {
        expected: expectedText,
        actual: actualText,
      });
      return false;
    }

    const range = document.createRange();
    range.setStart(node, annotation.position.offset);
    range.setEnd(node, annotation.position.offset + annotation.position.length);

    applyVisualHighlight(range, annotation.color, annotation.id);
    return true;
  } catch (error) {
    console.error('Failed to apply stored highlight:', error);
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

  // If clicking on a highlight, check if there's an underlying link
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

    // No link involved - show edit toolbar
    e.preventDefault();
    e.stopPropagation();
    hideHighlightToolbar();
    currentEditHighlight = {
      id: highlightElement.dataset.highlightId,
      element: highlightElement,
    };
    showEditToolbar(highlightElement);
    return;
  }

  // Otherwise, hide toolbars if no text selected
  const selection = window.getSelection();
  if (selection?.isCollapsed) {
    hideHighlightToolbar();
    hideEditToolbar();
  }
});

// Load existing highlights when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    highlightsLoadedPromise = loadExistingHighlights();
  });
} else {
  highlightsLoadedPromise = loadExistingHighlights();
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
  console.log('Webtero: Starting page capture with SingleFile...');

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

    console.log('Webtero: Page capture complete');
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
    // Skip if already applied (from current page annotations)
    if (document.querySelector(`.webtero-highlight[data-highlight-id="${annotation.id}"]`)) {
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
 * Apply a stored highlight from annotation data
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

    // Check if the text content still matches
    const textContent = node.textContent || '';
    const expectedText = annotation.text;
    const actualText = textContent.substring(
      annotation.position.offset,
      annotation.position.offset + annotation.position.length
    );

    // If the text doesn't match exactly, try to find it nearby
    if (actualText !== expectedText) {
      console.warn('Text mismatch for historical highlight:', {
        expected: expectedText,
        actual: actualText,
      });
      return false;
    }

    const range = document.createRange();
    range.setStart(node, annotation.position.offset);
    range.setEnd(node, annotation.position.offset + annotation.position.length);

    // Apply visual highlight with historical marker
    const span = document.createElement('span');
    span.className = 'webtero-highlight webtero-historical-highlight';
    span.dataset.highlightId = annotation.id;
    span.dataset.color = annotation.color;
    span.dataset.historical = 'true';
    span.style.backgroundColor = getColorValue(annotation.color);
    span.style.opacity = '0.3'; // Slightly dimmer for historical

    try {
      range.surroundContents(span);
    } catch (error) {
      console.warn('Could not apply historical highlight directly:', error);
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }

    return true;
  } catch (error) {
    console.error('Failed to apply historical highlight:', error);
    return false;
  }
}

/**
 * Remove all historical annotations from the page
 */
function removeHistoricalAnnotations() {
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
    // Remove pending state from the highlight
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
  const highlight = document.querySelector(
    `.webtero-highlight[data-highlight-id="${id}"]`
  ) as HTMLElement;

  if (!highlight) {
    console.warn('Highlight not found:', id);
    return;
  }

  // Scroll into view
  highlight.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });

  // Flash the highlight to draw attention
  const originalOpacity = highlight.style.opacity;
  highlight.style.transition = 'opacity 0.15s ease-in-out';

  // Flash sequence
  const flash = () => {
    highlight.style.opacity = '0.8';
    setTimeout(() => {
      highlight.style.opacity = '0.2';
      setTimeout(() => {
        highlight.style.opacity = '0.8';
        setTimeout(() => {
          highlight.style.opacity = originalOpacity || '0.4';
          highlight.style.transition = '';
        }, 150);
      }, 150);
    }, 150);
  };

  // Start flash after scroll completes
  setTimeout(flash, 300);
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
    console.log('Webtero: OAuth callback detected');

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
          console.log('Webtero: OAuth callback processed successfully');
          // Show success message on the page
          document.body.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: system-ui, sans-serif;">
              <h1 style="color: #4caf50; margin-bottom: 1rem;">Authorization Successful</h1>
              <p style="color: #666;">You can close this window and return to Webtero.</p>
              <p style="color: #999; font-size: 0.875rem; margin-top: 2rem;">This window will close automatically...</p>
            </div>
          `;
          // Try to close the window after a short delay
          setTimeout(() => {
            window.close();
          }, 2000);
        } else {
          console.error('Webtero: OAuth callback failed:', response?.error);
          document.body.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: system-ui, sans-serif;">
              <h1 style="color: #c62828; margin-bottom: 1rem;">Authorization Failed</h1>
              <p style="color: #666;">${response?.error || 'Unknown error occurred'}</p>
              <p style="color: #999; font-size: 0.875rem; margin-top: 2rem;">Please close this window and try again.</p>
            </div>
          `;
        }
      })
      .catch((error) => {
        console.error('Webtero: Failed to send OAuth callback:', error);
      });
  }
}
