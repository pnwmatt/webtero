import type { Annotation, HighlightColor } from '../lib/types';
import { getXPath, getNodeFromXPath, getColorValue } from '../lib/utils';

console.log('Webtero content script loaded');

let highlightToolbar: HTMLElement | null = null;
let editToolbar: HTMLElement | null = null;
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
 * Create highlight toolbar
 */
function createHighlightToolbar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.id = 'webtero-highlight-toolbar';
  toolbar.className = 'webtero-toolbar';

  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

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

  document.body.appendChild(toolbar);
  return toolbar;
}

/**
 * Create edit toolbar for existing highlights
 */
function createEditToolbar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.id = 'webtero-edit-toolbar';
  toolbar.className = 'webtero-toolbar webtero-edit-toolbar';

  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

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

  document.body.appendChild(toolbar);
  return toolbar;
}

/**
 * Show edit toolbar for an existing highlight
 */
function showEditToolbar(element: HTMLElement) {
  if (!editToolbar) {
    editToolbar = createEditToolbar();
  }

  const rect = element.getBoundingClientRect();
  editToolbar.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
  editToolbar.style.top = `${rect.top + window.scrollY - 50}px`;
  editToolbar.style.display = 'block';

  // Mark current color as selected
  const currentColor = element.dataset.color;
  editToolbar.querySelectorAll('.webtero-color-btn').forEach((btn) => {
    const btnEl = btn as HTMLElement;
    if (btnEl.dataset.color === currentColor) {
      btnEl.style.outline = '2px solid #333';
    } else {
      btnEl.style.outline = 'none';
    }
  });
}

/**
 * Hide edit toolbar
 */
function hideEditToolbar() {
  if (editToolbar) {
    editToolbar.style.display = 'none';
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

  highlightToolbar.style.left = `${x}px`;
  highlightToolbar.style.top = `${y - 50}px`;
  highlightToolbar.style.display = 'block';
}

/**
 * Hide highlight toolbar
 */
function hideHighlightToolbar() {
  if (highlightToolbar) {
    highlightToolbar.style.display = 'none';
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
 */
async function createHighlight(color: HighlightColor, comment?: string) {
  if (!currentSelection) return;

  try {
    const response = await browser.runtime.sendMessage({
      type: 'CREATE_ANNOTATION',
      data: {
        url: window.location.href,
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
      // Apply visual highlight
      applyVisualHighlight(currentSelection.range, color, response.data.id);
      hideHighlightToolbar();
      window.getSelection()?.removeAllRanges();
      currentSelection = null;
    } else {
      alert(`Failed to create highlight: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to create highlight:', error);
    alert('Failed to create highlight. Make sure the page is saved to Zotero first.');
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
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_ANNOTATIONS',
      data: { url: window.location.href },
    });

    if (response.success && Array.isArray(response.data)) {
      const annotations = response.data as Annotation[];
      annotations.forEach((ann) => {
        applyStoredHighlight(ann);
      });
    }
  } catch (error) {
    console.error('Failed to load highlights:', error);
  }
}

/**
 * Apply a stored highlight from annotation data
 */
function applyStoredHighlight(annotation: Annotation) {
  try {
    // Fix legacy XPath format: convert #text[n] to text()[n]
    let xpath = annotation.position.xpath;
    if (xpath.includes('#text[')) {
      xpath = xpath.replace(/#text\[(\d+)\]/g, 'text()[$1]');
    }

    const node = getNodeFromXPath(xpath);
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      console.warn('Could not find text node for highlight:', xpath);
      return;
    }

    const range = document.createRange();
    range.setStart(node, annotation.position.offset);
    range.setEnd(node, annotation.position.offset + annotation.position.length);

    applyVisualHighlight(range, annotation.color, annotation.id);
  } catch (error) {
    console.error('Failed to apply stored highlight:', error);
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

  // Check if clicking on a toolbar
  if (
    (highlightToolbar && highlightToolbar.contains(target)) ||
    (editToolbar && editToolbar.contains(target))
  ) {
    return;
  }

  // If clicking on a highlight, show edit toolbar
  if (highlightElement && highlightElement.dataset.highlightId) {
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
  document.addEventListener('DOMContentLoaded', loadExistingHighlights);
} else {
  loadExistingHighlights();
}

/**
 * Capture the current page HTML for snapshot
 * This is a simplified version - a full implementation would use SingleFile
 */
function capturePageHTML(): string {
  // Clone the document to avoid modifying the current page
  const docClone = document.cloneNode(true) as Document;

  // Remove webtero-specific elements from the clone
  const webteroElements = docClone.querySelectorAll(
    '#webtero-highlight-toolbar, #webtero-edit-toolbar, .webtero-highlight'
  );
  webteroElements.forEach((el) => {
    // For highlights, unwrap them (keep text content)
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

  // Add meta tag indicating this is a snapshot
  const metaTag = docClone.createElement('meta');
  metaTag.name = 'webtero-snapshot';
  metaTag.content = new Date().toISOString();
  docClone.head?.appendChild(metaTag);

  // Return the full HTML
  return '<!DOCTYPE html>\n' + docClone.documentElement.outerHTML;
}

// Listen for messages from background script
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'CAPTURE_PAGE_HTML') {
    try {
      const html = capturePageHTML();
      return Promise.resolve({ success: true, data: html });
    } catch (error) {
      console.error('Failed to capture page HTML:', error);
      return Promise.resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  return undefined;
});
