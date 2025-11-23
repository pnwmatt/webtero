import type { SavedPage, Annotation, Project, Snapshot, OutboxAnnotation } from '../lib/types';
import { storage } from '../lib/storage';
import { formatDate } from '../lib/utils';
import { config } from '../lib/config';

// DOM elements - Sign-in overlay
const signInOverlay = document.getElementById('signInOverlay') as HTMLDivElement;
const signInBtn = document.getElementById('signInBtn') as HTMLButtonElement;
const signInError = document.getElementById('signInError') as HTMLParagraphElement;

// DOM elements - Main sidebar
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const pageStatus = document.getElementById('pageStatus') as HTMLDivElement;
const pageActions = document.getElementById('pageActions') as HTMLDivElement;
const savedInfo = document.getElementById('savedInfo') as HTMLDivElement;
const savedDate = document.getElementById('savedDate') as HTMLParagraphElement;
const savedProject = document.getElementById('savedProject') as HTMLParagraphElement;
const savedIcon = document.getElementById('savedIcon') as HTMLSpanElement;
const projectDropdown = document.getElementById('projectDropdown') as HTMLSelectElement;
const savePageBtn = document.getElementById('savePageBtn') as HTMLButtonElement;
const annotationsList = document.getElementById('annotationsList') as HTMLDivElement;
const refreshAnnotations = document.getElementById('refreshAnnotations') as HTMLButtonElement;
const projectsList = document.getElementById('projectsList') as HTMLDivElement;
const syncProjects = document.getElementById('syncProjects') as HTMLButtonElement;
const newProject = document.getElementById('newProject') as HTMLButtonElement;
const newProjectModal = document.getElementById('newProjectModal') as HTMLDivElement;
const newProjectForm = document.getElementById('newProjectForm') as HTMLFormElement;
const projectName = document.getElementById('projectName') as HTMLInputElement;
const parentProject = document.getElementById('parentProject') as HTMLSelectElement;
const cancelProject = document.getElementById('cancelProject') as HTMLButtonElement;
const zoteroReaderOverlay = document.getElementById('zoteroReaderOverlay') as HTMLDivElement;
const mainSidebar = document.getElementById('mainSidebar') as HTMLDivElement;
const versionsList = document.getElementById('versionsList') as HTMLDivElement;
const showAllAnnotationsBtn = document.getElementById('showAllAnnotations') as HTMLButtonElement;
const readProgress = document.getElementById('readProgress') as HTMLDivElement;
const readProgressFill = document.getElementById('readProgressFill') as HTMLDivElement;
const readProgressText = document.getElementById('readProgressText') as HTMLSpanElement;

let currentTab: browser.tabs.Tab | null = null;
let currentPage: SavedPage | null = null;
let currentSnapshots: Snapshot[] = [];
let currentAnnotations: Annotation[] = [];
let currentOutboxAnnotations: OutboxAnnotation[] = [];
let showingAllAnnotations = false;
let pageLoadTime: Date = new Date();
let liveVersionTimer: ReturnType<typeof setInterval> | null = null;

// Highlight icon SVG (from zotero-reader)
const HIGHLIGHT_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.7 13.4c-.1.1-.2.3-.2.5 0 .4.3.7.7.7.2 0 .4-.1.5-.2l5.8-5.8-1-1-5.8 5.8zM13 3.9l-.9-.9c-.4-.4-1-.4-1.4 0l-1.2 1.2 2.3 2.3 1.2-1.2c.4-.4.4-1 0-1.4zM4.5 7.7l2.3 2.3 4.6-4.6-2.3-2.3-4.6 4.6z"/></svg>`;

/**
 * Check if URL is a restricted page where Webtero cannot operate
 */
function isRestrictedUrl(url: string): boolean {
  // Check for browser internal protocols
  const restrictedProtocols = ['about:', 'mozilla:', 'chrome:', 'moz-extension:', 'config:', 'resource:'];
  if (restrictedProtocols.some((protocol) => url.startsWith(protocol))) {
    return true;
  }

  // Check for specific restricted domains
  try {
    const urlObj = new URL(url);
    const restrictedHosts = [
      'addons.mozilla.org',
      'accounts.firefox.com',
      'support.mozilla.org',
      'zotero.org',
      'www.zotero.org',
    ];
    return restrictedHosts.includes(urlObj.hostname);
  } catch {
    return true; // Invalid URLs are restricted
  }
}

/**
 * Check if current URL is a Zotero Web Library reader page
 * Pattern: zotero.org/{username}/items/{itemKey}/attachment/{attachmentKey}/reader
 */
function isZoteroReaderPage(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname === 'www.zotero.org' ||
      urlObj.hostname === 'zotero.org'
    ) && urlObj.pathname.includes('/reader');
  } catch {
    return false;
  }
}

/**
 * Handle Zotero reader page detection
 */
function handleZoteroReaderPage(url: string) {
  if (isZoteroReaderPage(url)) {
    // Show overlay, hide main sidebar
    zoteroReaderOverlay.style.display = 'flex';
    mainSidebar.style.display = 'none';
  } else {
    // Show main sidebar, hide overlay
    zoteroReaderOverlay.style.display = 'none';
    mainSidebar.style.display = 'flex';
  }
}

// Get current tab
async function getCurrentTab(): Promise<browser.tabs.Tab | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

// Load page data
async function loadPageData() {
  currentTab = await getCurrentTab();
  if (!currentTab?.url) {
    pageStatus.innerHTML = '<p class="error">No active tab</p>';
    return;
  }

  // Check if on restricted page
  if (isRestrictedUrl(currentTab.url)) {
    pageStatus.style.display = 'block';
    pageStatus.innerHTML = '<p class="empty">Webtero is not available on this site.</p>';
    pageActions.style.display = 'none';
    savePageBtn.disabled = true;
    return;
  }

  // Check if on Zotero reader page
  handleZoteroReaderPage(currentTab.url);

  // Re-enable save button and show page actions (may have been disabled by restricted URL)
  pageActions.style.display = 'block';
  savePageBtn.disabled = false;

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_PAGE_DATA',
      data: { url: currentTab.url },
    });

    if (response.success) {
      currentPage = response.data.page;
      currentSnapshots = response.data.snapshots || [];
      currentAnnotations = response.data.annotations || [];
      showingAllAnnotations = false;

      // Load outbox annotations for this page
      const outboxResponse = await browser.runtime.sendMessage({
        type: 'GET_OUTBOX_ANNOTATIONS',
        data: { url: currentTab.url },
      });
      currentOutboxAnnotations = outboxResponse.success ? outboxResponse.data : [];

      await displayPageStatus();

      // Query content script for which annotations couldn't be found
      if (currentTab?.id && currentAnnotations.length > 0) {
        try {
          const notFoundResponse = await browser.tabs.sendMessage(currentTab.id, {
            type: 'GET_NOT_FOUND_ANNOTATIONS',
          });
          if (notFoundResponse?.success && notFoundResponse.data?.notFoundIds) {
            const notFoundIds = new Set(notFoundResponse.data.notFoundIds);
            currentAnnotations = currentAnnotations.map((ann) => ({
              ...ann,
              notFound: notFoundIds.has(ann.id),
            }));
          }
        } catch (error) {
          // Content script may not be loaded yet, ignore
          console.debug('Could not query not-found annotations:', error);
        }
      }

      displayAnnotations(currentAnnotations, currentOutboxAnnotations);

      // Load links for this page
      loadLinks();

      // Enable focus tracking and link indicators for saved pages
      checkAndEnableTracking();
    } else {
      pageStatus.innerHTML = `<p class="error">${response.error}</p>`;
    }
  } catch (error) {
    console.error('Failed to load page data:', error);
    pageStatus.innerHTML = '<p class="error">Failed to load page data</p>';
  }
}

// Display page status
async function displayPageStatus() {
  pageStatus.style.display = 'none';
  pageActions.style.display = 'block';

  // Reset page load time when displaying status
  pageLoadTime = new Date();

  // Load projects into the header dropdown
  await loadProjectsForDropdown();

  if (currentPage) {
    // Show saved state with versions
    savedInfo.style.display = 'block';
    savedIcon.style.display = 'inline';

    // Hide the redundant date/project text
    savedDate.style.display = 'none';
    savedProject.style.display = 'none';

    // Update button text for adding snapshots
    savePageBtn.textContent = 'Save';

    // Display versions list
    displayVersionsList();
    startLiveVersionTimer();

    // Update read progress
    await updateReadProgress();
  } else {
    // First time saving
    savedInfo.style.display = 'none';
    savedIcon.style.display = 'none';
    savePageBtn.textContent = 'Save';
    stopLiveVersionTimer();

    // Hide read progress for unsaved pages
    readProgress.style.display = 'none';
  }
}

// Get relative time string from a date
function getRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;

  return date.toLocaleDateString();
}

// Start timer to update Live Version timestamp
function startLiveVersionTimer() {
  stopLiveVersionTimer();
  liveVersionTimer = setInterval(() => {
    const liveVersionDate = document.querySelector('.live-version .version-date');
    if (liveVersionDate) {
      liveVersionDate.textContent = getRelativeTime(pageLoadTime);
    }
  }, 10000); // Update every 10 seconds
}

// Stop the Live Version timer
function stopLiveVersionTimer() {
  if (liveVersionTimer) {
    clearInterval(liveVersionTimer);
    liveVersionTimer = null;
  }
}

// Display versions list (Live + Snapshots)
function displayVersionsList() {
  if (!currentPage) return;

  let html = `
    <div class="version live-version active">
      <span class="version-icon">&#9679;</span>
      <span class="version-label">Live Version</span>
      <span class="version-date">${getRelativeTime(pageLoadTime)}</span>
    </div>
  `;

  // Add snapshots
  if (currentSnapshots.length > 0) {
    html += currentSnapshots
      .map(
        (snapshot) => `
        <div class="version snapshot" data-key="${snapshot.key}" data-item-key="${currentPage?.zoteroItemKey}">
          <span class="version-icon">&#128247;</span>
          <span class="version-label">${escapeHtml(snapshot.title)}</span>
          <span class="version-date">${formatDate(snapshot.dateAdded)}</span>
        </div>
      `
      )
      .join('');

    // Show "Show all annotations" button if there are snapshots
    showAllAnnotationsBtn.style.display = 'block';
    showAllAnnotationsBtn.textContent = showingAllAnnotations
      ? 'Show current annotations only'
      : 'Show all annotations';
  } else {
    showAllAnnotationsBtn.style.display = 'none';
  }

  versionsList.innerHTML = html;

  // Add click handlers for snapshots
  versionsList.querySelectorAll('.snapshot').forEach((el) => {
    el.addEventListener('click', () => {
      const snapshotKey = (el as HTMLElement).dataset.key;
      const itemKey = (el as HTMLElement).dataset.itemKey;
      if (snapshotKey && itemKey) {
        openSnapshotInReader(itemKey, snapshotKey);
      }
    });
  });
}

// Open a snapshot in Zotero Web Library Reader
async function openSnapshotInReader(itemKey: string, snapshotKey: string) {
  try {
    const auth = await storage.getAuth();
    if (!auth?.userID) {
      alert('Please configure your Zotero API key in settings');
      return;
    }

    // Build Web Library reader URL
    // Format: https://www.zotero.org/{username}/items/{itemKey}/attachment/{snapshotKey}/reader
    const readerUrl = `https://www.zotero.org/users/${auth.userID}/items/${itemKey}/attachment/${snapshotKey}/reader`;
    await browser.tabs.create({ url: readerUrl });
  } catch (error) {
    console.error('Failed to open snapshot in reader:', error);
    alert('Failed to open snapshot');
  }
}

// Build hierarchical project list sorted by last modified descending
function buildHierarchicalProjectList(projects: Project[]): Project[] {
  // Separate top-level and child projects
  const topLevel = projects.filter((p) => !p.parentId);
  const children = projects.filter((p) => p.parentId);

  // Sort top-level by dateModified descending
  topLevel.sort((a, b) => {
    const dateA = a.dateModified ? new Date(a.dateModified).getTime() : 0;
    const dateB = b.dateModified ? new Date(b.dateModified).getTime() : 0;
    return dateB - dateA;
  });

  // Group children by parent
  const childrenByParent: Record<string, Project[]> = {};
  for (const child of children) {
    if (child.parentId) {
      if (!childrenByParent[child.parentId]) {
        childrenByParent[child.parentId] = [];
      }
      childrenByParent[child.parentId].push(child);
    }
  }

  // Sort each group of children by dateModified descending
  for (const parentId of Object.keys(childrenByParent)) {
    childrenByParent[parentId].sort((a, b) => {
      const dateA = a.dateModified ? new Date(a.dateModified).getTime() : 0;
      const dateB = b.dateModified ? new Date(b.dateModified).getTime() : 0;
      return dateB - dateA;
    });
  }

  // Build final list: parent followed by its children
  const result: Project[] = [];
  for (const parent of topLevel) {
    result.push(parent);
    if (childrenByParent[parent.id]) {
      result.push(...childrenByParent[parent.id]);
    }
  }

  return result;
}

// Load projects into dropdown
async function loadProjectsForDropdown() {
  // Preserve current selection
  const previousValue = projectDropdown.value;

  const projects = await storage.getAllProjects();
  const projectsArray = Object.values(projects);

  if (projectsArray.length === 0) {
    projectDropdown.innerHTML = '<option value="">No projects (click sync)</option>';
    return;
  }

  // Build hierarchical sorted list
  const sortedProjects = buildHierarchicalProjectList(projectsArray);

  projectDropdown.innerHTML =
    '<option value="">My Library (no project)</option>' +
    sortedProjects
      .map(
        (p) =>
          `<option value="${p.id}">${p.parentId ? '\u00A0\u00A0' : ''}${escapeHtml(p.name)}</option>`
      )
      .join('');

  // Restore previous selection if it still exists
  if (previousValue && projectDropdown.querySelector(`option[value="${previousValue}"]`)) {
    projectDropdown.value = previousValue;
  }
}

// Save page
savePageBtn.addEventListener('click', async () => {
  if (!currentTab?.url || !currentTab?.title) return;

  savePageBtn.disabled = true;
  savePageBtn.textContent = 'Saving...';

  try {
    const selectedProject = projectDropdown.value;
    const collections = selectedProject ? [selectedProject] : [];

    const response = await browser.runtime.sendMessage({
      type: 'SAVE_PAGE',
      data: {
        url: currentTab.url,
        title: currentTab.title,
        collections,
      },
    });

    if (response.success) {
      const { itemKey } = response.data;

      // Enable auto-save mode and focus tracking for this tab
      if (currentTab.id && itemKey) {
        await enableAutoSaveAndTracking(currentTab.id, itemKey, currentTab.url);
      }

      await loadPageData();
    } else {
      alert(`Failed to save page: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to save page:', error);
    alert('Failed to save page');
  } finally {
    savePageBtn.disabled = false;
    // Restore appropriate button text based on state
    savePageBtn.textContent = 'Save';
  }
});

// Display annotations (zotero-reader style)
function displayAnnotations(annotations: Annotation[], outboxAnnotations: OutboxAnnotation[] = []) {
  if (annotations.length === 0 && outboxAnnotations.length === 0) {
    annotationsList.innerHTML =
      '<p class="empty">No annotations yet. Highlight text on the page to create one.</p>';
    return;
  }

  // Render outbox annotations first (they're pending)
  const outboxHtml = outboxAnnotations
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .map((ann) => renderOutboxAnnotation(ann))
    .join('');

  // Then render saved annotations
  const savedHtml = annotations
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .map((ann) => renderAnnotation(ann))
    .join('');

  annotationsList.innerHTML = outboxHtml + savedHtml;

  // Add delete handlers
  document.querySelectorAll('.delete-annotation').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (e.target as HTMLElement).dataset.id;
      if (id && confirm('Delete this annotation?')) {
        await deleteAnnotation(id);
      }
    });
  });

  // Add click handlers to scroll to annotation
  document.querySelectorAll('.annotation').forEach((card) => {
    card.addEventListener('click', async (e) => {
      // Don't trigger if clicking on buttons
      if ((e.target as HTMLElement).closest('button')) return;

      const id = (card as HTMLElement).dataset.id;
      if (id && currentTab?.id) {
        try {
          await browser.tabs.sendMessage(currentTab.id, {
            type: 'SCROLL_TO_HIGHLIGHT',
            data: { id },
          });
        } catch (error) {
          console.error('Failed to scroll to highlight:', error);
        }
      }
    });
  });

  // Add outbox annotation handlers
  document.querySelectorAll('.delete-outbox').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        await deleteOutboxAnnotation(id);
      }
    });
  });

  document.querySelectorAll('.retry-outbox').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        await retryOutboxAnnotation(id);
      }
    });
  });
}

// Render a single annotation in zotero-reader style
function renderAnnotation(ann: Annotation): string {
  const color = ann.color || 'yellow';
  const notFoundClass = ann.notFound ? 'not-found' : '';
  const historicalClass = ann.snapshotKey ? 'historical' : '';
  const notFoundWarning = ann.notFound
    ? `<div class="annotation-warning">&#9888; Could not find this highlight on the current page</div>`
    : '';

  return `
    <div class="annotation ${notFoundClass} ${historicalClass}" data-id="${ann.id}" data-color="${color}">
      <div class="annotation-header">
        <div class="start">
          <span class="annotation-icon">${HIGHLIGHT_ICON}</span>
        </div>
        <div class="end">
          <button class="annotation-options" title="More options">&#8230;</button>
        </div>
      </div>
      ${notFoundWarning}
      <div class="annotation-text">
        <div class="blockquote-border"></div>
        <div class="content">${escapeHtml(ann.text)}</div>
      </div>
      ${ann.comment ? `<div class="annotation-comment">${escapeHtml(ann.comment)}</div>` : ''}
      <div class="annotation-meta">
        <span>${formatDate(ann.created)}</span>
        ${!ann.snapshotKey ? `<button class="delete-annotation" data-id="${ann.id}" title="Delete">&#215;</button>` : ''}
      </div>
    </div>
  `;
}

// Render an outbox annotation (pending upload)
function renderOutboxAnnotation(ann: OutboxAnnotation): string {
  const color = ann.color || 'yellow';
  const statusText = getOutboxStatusText(ann.status);
  const statusClass = ann.status === 'failed' ? 'outbox-failed' : 'outbox-pending';
  const errorHtml = ann.error
    ? `<div class="annotation-warning">&#9888; ${escapeHtml(ann.error)}</div>`
    : '';

  return `
    <div class="annotation outbox-annotation ${statusClass}" data-outbox-id="${ann.id}" data-color="${color}">
      <div class="annotation-header">
        <div class="start">
          <span class="annotation-icon">${HIGHLIGHT_ICON}</span>
          <span class="outbox-status">${statusText}</span>
        </div>
        <div class="end">
          ${ann.status === 'failed' ? `<button class="retry-outbox" data-id="${ann.id}" title="Retry">&#8635;</button>` : ''}
          <button class="delete-outbox" data-id="${ann.id}" title="Cancel">&#215;</button>
        </div>
      </div>
      ${errorHtml}
      <div class="annotation-text">
        <div class="blockquote-border"></div>
        <div class="content">${escapeHtml(ann.text)}</div>
      </div>
      ${ann.comment ? `<div class="annotation-comment">${escapeHtml(ann.comment)}</div>` : ''}
      <div class="annotation-meta">
        <span>${formatDate(ann.created)}</span>
      </div>
    </div>
  `;
}

// Get human-readable status text for outbox annotation
function getOutboxStatusText(status: OutboxAnnotation['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending...';
    case 'saving_page':
      return 'Saving page...';
    case 'saving_annotation':
      return 'Saving annotation...';
    case 'failed':
      return 'Failed';
    default:
      return 'Pending...';
  }
}

// Delete annotation
async function deleteAnnotation(id: string) {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'DELETE_ANNOTATION',
      data: { id },
    });

    if (response.success) {
      await loadPageData();
    } else {
      alert(`Failed to delete annotation: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to delete annotation:', error);
    alert('Failed to delete annotation');
  }
}

// Delete outbox annotation (cancel pending upload)
async function deleteOutboxAnnotation(id: string) {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'DELETE_OUTBOX_ANNOTATION',
      data: { id },
    });

    if (response.success) {
      await loadPageData();
    } else {
      alert(`Failed to cancel: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to delete outbox annotation:', error);
  }
}

// Retry failed outbox annotation
async function retryOutboxAnnotation(id: string) {
  if (!currentTab?.title) return;

  try {
    const response = await browser.runtime.sendMessage({
      type: 'RETRY_OUTBOX_ANNOTATION',
      data: {
        id,
        title: currentTab.title,
        collections: projectDropdown.value ? [projectDropdown.value] : [],
      },
    });

    if (response.success) {
      await loadPageData();
    } else {
      alert(`Failed to retry: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to retry outbox annotation:', error);
  }
}

// Refresh annotations
refreshAnnotations.addEventListener('click', loadPageData);

// Load and display projects
async function loadProjects() {
  const projects = await storage.getAllProjects();
  const projectsArray = Object.values(projects);

  if (projectsArray.length === 0) {
    projectsList.innerHTML =
      '<p class="empty">No projects. Click sync to load from Zotero.</p>';
    return;
  }

  // Build hierarchical sorted list
  const sortedProjects = buildHierarchicalProjectList(projectsArray);

  projectsList.innerHTML = sortedProjects
    .map(
      (p) => `
      <div class="project" data-id="${p.id}">
        <div class="project-name">${p.parentId ? '\u00A0\u00A0' : ''}${escapeHtml(p.name)}</div>
        <div class="project-count">${p.itemCount}</div>
      </div>
    `
    )
    .join('');

  // Add click handlers to select project in dropdown
  projectsList.querySelectorAll('.project').forEach((el) => {
    el.addEventListener('click', () => {
      const projectId = (el as HTMLElement).dataset.id;
      if (projectId) {
        projectDropdown.value = projectId;
      }
    });
  });
}

// Sync projects
syncProjects.addEventListener('click', async () => {
  syncProjects.disabled = true;
  syncProjects.textContent = '\u21BB';

  try {
    const response = await browser.runtime.sendMessage({
      type: 'SYNC_PROJECTS',
    });

    if (response.success) {
      await loadProjects();
      await loadProjectsForDropdown();
    } else {
      alert(`Failed to sync projects: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to sync projects:', error);
    alert('Failed to sync projects');
  } finally {
    syncProjects.disabled = false;
    syncProjects.textContent = '\u21BB';
  }
});

// New project
newProject.addEventListener('click', async () => {
  // Load projects for parent select
  const projects = await storage.getAllProjects();
  const projectsArray = Object.values(projects);

  parentProject.innerHTML =
    '<option value="">No parent (top-level)</option>' +
    projectsArray
      .filter((p) => !p.parentId)
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join('');

  newProjectModal.style.display = 'flex';
  projectName.focus();
});

// Cancel new project
cancelProject.addEventListener('click', () => {
  newProjectModal.style.display = 'none';
  newProjectForm.reset();
});

// Create new project
newProjectForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = projectName.value.trim();
  const parent = parentProject.value || undefined;

  if (!name) return;

  try {
    // Send to background to create via API
    const response = await browser.runtime.sendMessage({
      type: 'CREATE_COLLECTION',
      data: { name, parentId: parent },
    });

    if (response.success) {
      newProjectModal.style.display = 'none';
      newProjectForm.reset();
      await syncProjects.click();
    } else {
      alert(`Failed to create project: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to create project:', error);
    alert('Failed to create project');
  }
});

// Settings button
settingsBtn.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

// Utility
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Auto-Save and Focus Tracking
// ============================================

/**
 * Enable auto-save mode and focus tracking for a tab
 */
async function enableAutoSaveAndTracking(tabId: number, itemKey: string, url: string) {
  try {
    // Enable auto-save in background
    await browser.runtime.sendMessage({
      type: 'ENABLE_AUTO_SAVE',
      data: { tabId, sourceItemKey: itemKey, sourceUrl: url },
    });

    // Tell content script to start focus tracking and enable auto-save mode
    await browser.tabs.sendMessage(tabId, {
      type: 'START_FOCUS_TRACKING',
      data: { itemKey },
    });

    await browser.tabs.sendMessage(tabId, {
      type: 'ENABLE_AUTO_SAVE_MODE',
      data: { itemKey },
    });

    // Enable link indicators
    await browser.tabs.sendMessage(tabId, {
      type: 'ENABLE_LINK_INDICATORS',
    });

    console.log('Auto-save and tracking enabled for tab', tabId);
  } catch (error) {
    console.error('Failed to enable auto-save and tracking:', error);
  }
}

/**
 * Update the read progress indicator
 */
async function updateReadProgress() {
  if (!currentPage?.zoteroItemKey) {
    readProgress.style.display = 'none';
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_PAGE_READ_PERCENTAGE',
      data: { itemKey: currentPage.zoteroItemKey },
    });

    if (response.success) {
      const percentage = response.data.percentage || 0;
      readProgress.style.display = 'flex';
      readProgressFill.style.width = `${percentage}%`;
      readProgressText.textContent = `${percentage}% read`;
    }
  } catch (error) {
    console.error('Failed to get read percentage:', error);
    readProgress.style.display = 'none';
  }
}

/**
 * Check if current page is saved and enable tracking if so
 */
async function checkAndEnableTracking() {
  if (!currentTab?.id || !currentPage?.zoteroItemKey) return;

  try {
    // Start focus tracking for saved pages
    await browser.tabs.sendMessage(currentTab.id, {
      type: 'START_FOCUS_TRACKING',
      data: { itemKey: currentPage.zoteroItemKey },
    });

    // Enable link indicators
    await browser.tabs.sendMessage(currentTab.id, {
      type: 'ENABLE_LINK_INDICATORS',
    });
  } catch (error) {
    // Content script may not be loaded yet
    console.debug('Could not enable tracking:', error);
  }
}

// ============================================
// Links Display
// ============================================

const linksList = document.getElementById('linksList') as HTMLDivElement;

interface LinkedPage {
  itemKey: string;
  url: string;
  direction: 'outgoing' | 'incoming';
  readPercentage: number;
}

/**
 * Load and display links for the current page
 */
async function loadLinks() {
  if (!currentPage?.zoteroItemKey) {
    linksList.innerHTML = '<p class="empty">Save this page to start tracking links.</p>';
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_PAGE_LINKS',
      data: { itemKey: currentPage.zoteroItemKey },
    });

    if (response.success && Array.isArray(response.data)) {
      displayLinks(response.data as LinkedPage[]);
    }
  } catch (error) {
    console.error('Failed to load links:', error);
    linksList.innerHTML = '<p class="empty">Failed to load links.</p>';
  }
}

/**
 * Display linked pages
 */
function displayLinks(links: LinkedPage[]) {
  if (links.length === 0) {
    linksList.innerHTML =
      '<p class="empty">No links yet. Click links on this page after saving to track them.</p>';
    return;
  }

  const outgoing = links.filter((l) => l.direction === 'outgoing');
  const incoming = links.filter((l) => l.direction === 'incoming');

  let html = '';

  if (outgoing.length > 0) {
    html += '<div class="link-group"><h4>Links from this page</h4>';
    html += outgoing
      .map(
        (link) => `
        <div class="link-item" data-url="${escapeHtml(link.url)}">
          <span class="link-indicator">[wt ${link.readPercentage}%]</span>
          <span class="link-url" title="${escapeHtml(link.url)}">${escapeHtml(truncateUrl(link.url))}</span>
        </div>
      `
      )
      .join('');
    html += '</div>';
  }

  if (incoming.length > 0) {
    html += '<div class="link-group"><h4>Links to this page</h4>';
    html += incoming
      .map(
        (link) => `
        <div class="link-item" data-url="${escapeHtml(link.url)}">
          <span class="link-indicator">[wt ${link.readPercentage}%]</span>
          <span class="link-url" title="${escapeHtml(link.url)}">${escapeHtml(truncateUrl(link.url))}</span>
        </div>
      `
      )
      .join('');
    html += '</div>';
  }

  linksList.innerHTML = html;

  // Add click handlers to navigate to linked pages
  linksList.querySelectorAll('.link-item').forEach((el) => {
    el.addEventListener('click', () => {
      const url = (el as HTMLElement).dataset.url;
      if (url) {
        browser.tabs.create({ url });
      }
    });
  });
}

/**
 * Truncate URL for display
 */
function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.length > 40) {
      return parsed.hostname + path.slice(0, 37) + '...';
    }
    return parsed.hostname + path;
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '...' : url;
  }
}

/**
 * Check authentication status and show appropriate UI
 */
async function checkAuthAndInitialize(): Promise<void> {
  // If OAuth is enabled, check if user is authenticated
  if (config.features.oauthEnabled) {
    const auth = await storage.getAuth();
    const isAuthenticated = !!(auth?.apiKey && auth?.userID);

    if (!isAuthenticated) {
      // Show sign-in overlay, hide main sidebar
      signInOverlay.style.display = 'flex';
      mainSidebar.style.display = 'none';
      return;
    }
  }

  // User is authenticated (or OAuth is disabled) - show main sidebar
  signInOverlay.style.display = 'none';
  mainSidebar.style.display = 'flex';

  // Initialize the sidebar
  loadPageData();
  loadProjects();
}

/**
 * Handle sign-in button click
 */
async function handleSignIn(): Promise<void> {
  signInBtn.disabled = true;
  signInBtn.textContent = 'Signing in...';
  signInError.style.display = 'none';

  try {
    const response = await browser.runtime.sendMessage({ type: 'OAUTH_START' });

    if (!response.success) {
      throw new Error(response.error || 'Sign-in failed');
    }

    // Success - reload to show main sidebar
    await checkAuthAndInitialize();
  } catch (error) {
    console.error('OAuth sign-in failed:', error);
    signInError.textContent = error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
    signInError.style.display = 'block';
  } finally {
    signInBtn.disabled = false;
    signInBtn.textContent = 'Sign in with Zotero';
  }
}

// Sign-in button handler
signInBtn.addEventListener('click', handleSignIn);

// Initialize
checkAuthAndInitialize();

// Listen for tab changes
browser.tabs.onActivated.addListener(() => {
  loadPageData();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    loadPageData();
  }
});

// Listen for annotation changes from background script
browser.runtime.onMessage.addListener((message) => {
  if (
    message.type === 'ANNOTATION_CREATED' ||
    message.type === 'ANNOTATION_DELETED' ||
    message.type === 'ANNOTATION_UPDATED'
  ) {
    loadPageData();
  }

  // Listen for outbox annotation updates
  if (
    message.type === 'OUTBOX_ANNOTATION_ADDED' ||
    message.type === 'OUTBOX_ANNOTATION_UPDATED' ||
    message.type === 'OUTBOX_ANNOTATION_COMPLETED' ||
    message.type === 'OUTBOX_ANNOTATION_DELETED'
  ) {
    loadPageData();
  }
});

// Show all annotations button handler
showAllAnnotationsBtn.addEventListener('click', async () => {
  if (!currentTab?.id || !currentPage) return;

  showingAllAnnotations = !showingAllAnnotations;

  if (showingAllAnnotations) {
    // Fetch all annotations from all snapshots
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_ALL_SNAPSHOT_ANNOTATIONS',
        data: { itemKey: currentPage.zoteroItemKey },
      });

      if (response.success && Array.isArray(response.data)) {
        const allAnnotations = response.data as Annotation[];

        // Send to content script to apply highlighting and detect which ones can't be found
        const applyResponse = await browser.tabs.sendMessage(currentTab.id, {
          type: 'APPLY_HISTORICAL_ANNOTATIONS',
          data: { annotations: allAnnotations },
        });

        if (applyResponse.success) {
          // Update annotations with notFound status
          const updatedAnnotations = allAnnotations.map((ann) => ({
            ...ann,
            notFound: applyResponse.data?.notFoundIds?.includes(ann.id) || false,
          }));

          // Display all annotations (current + historical)
          displayAnnotations([...currentAnnotations, ...updatedAnnotations]);
        }
      }
    } catch (error) {
      console.error('Failed to load all annotations:', error);
    }

    showAllAnnotationsBtn.textContent = 'Show current annotations only';
  } else {
    // Remove historical highlights and show only current annotations
    try {
      await browser.tabs.sendMessage(currentTab.id, {
        type: 'REMOVE_HISTORICAL_ANNOTATIONS',
      });
    } catch (error) {
      console.error('Failed to remove historical annotations:', error);
    }

    displayAnnotations(currentAnnotations);
    showAllAnnotationsBtn.textContent = 'Show all annotations';
  }
});
