import type { Annotation, HighlightColor } from '../lib/types';
import { getXPath, getNodeFromXPath, getColorValue } from '../lib/utils';

console.log('Webtero content script loaded');

let highlightToolbar: HTMLElement | null = null;
let currentSelection: {
  text: string;
  range: Range;
  xpath: string;
  offset: number;
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
    const node = getNodeFromXPath(annotation.position.xpath);
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      console.warn('Could not find node for highlight:', annotation.position.xpath);
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

// Click outside to hide toolbar
document.addEventListener('click', (e) => {
  if (
    highlightToolbar &&
    !highlightToolbar.contains(e.target as Node) &&
    !(e.target as HTMLElement).closest('.webtero-highlight')
  ) {
    const selection = window.getSelection();
    if (selection?.isCollapsed) {
      hideHighlightToolbar();
    }
  }
});

// Load existing highlights when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadExistingHighlights);
} else {
  loadExistingHighlights();
}
