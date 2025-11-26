import type { SavedPage, Annotation, Project, Snapshot, OutboxAnnotation, Settings } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';
import { storage } from '../lib/storage';
import { formatDate } from '../lib/utils';
import { config } from '../lib/config';

const LOG_LEVEL = 0;

// Cached settings (loaded on init)
let cachedSettings: Settings = DEFAULT_SETTINGS;

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
const autoSaveIcon = document.getElementById('autoSaveIcon') as HTMLSpanElement;
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
const readProgress = document.getElementById('readProgress') as HTMLDivElement;
const readProgressFill = document.getElementById('readProgressFill') as HTMLDivElement;
const readProgressText = document.getElementById('readProgressText') as HTMLSpanElement;
const liveVersionDate = document.getElementById('liveVersionDate') as HTMLSpanElement;
const versionsSection = document.getElementById('versionsSection') as HTMLDivElement;
const saveProgress = document.getElementById('saveProgress') as HTMLDivElement;
const saveProgressFill = document.getElementById('saveProgressFill') as HTMLDivElement;
const saveProgressText = document.getElementById('saveProgressText') as HTMLSpanElement;

let currentTab: browser.tabs.Tab | null = null;

/**
 * Send a message to the content script with retry logic.
 * Useful when the content script may not be loaded yet.
 */
async function sendMessageToContentScript<T>(
  tabId: number,
  message: { type: string; [key: string]: unknown },
  maxRetries = 3,
  initialDelayMs = 100
): Promise<T | null> {
  let delay = initialDelayMs;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await browser.tabs.sendMessage(tabId, message);
      return response as T;
    } catch {
      if (attempt < maxRetries - 1) {
        // Wait before retrying with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
  return null;
}
let currentPage: SavedPage | null = null;
let currentSnapshots: Snapshot[] = [];
let currentAnnotations: Annotation[] = [];
let currentOutboxAnnotations: OutboxAnnotation[] = [];
let pageLoadTime: Date = new Date();
let liveVersionTimer: ReturnType<typeof setInterval> | null = null;
let readProgressTimer: ReturnType<typeof setInterval> | null = null;

// Create highlight icon SVG element (from zotero-reader)
function createHighlightIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2.7 13.4c-.1.1-.2.3-.2.5 0 .4.3.7.7.7.2 0 .4-.1.5-.2l5.8-5.8-1-1-5.8 5.8zM13 3.9l-.9-.9c-.4-.4-1-.4-1.4 0l-1.2 1.2 2.3 2.3 1.2-1.2c.4-.4.4-1 0-1.4zM4.5 7.7l2.3 2.3 4.6-4.6-2.3-2.3-4.6 4.6z');
  svg.appendChild(path);
  return svg;
}

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
    setPageStatusError('No active tab');
    return;
  }

  // Check if on restricted page
  if (isRestrictedUrl(currentTab.url)) {
    pageStatus.style.display = 'block';
    setEmptyMessage(pageStatus, 'Webtero is not available on this site.');
    pageActions.style.display = 'none';
    savePageBtn.disabled = true;
    // Reset Links and Annotations sections
    setEmptyMessage(linksList, 'No links yet. Save this page and then click a link from this page to create a link.');
    setEmptyMessage(annotationsList, 'No annotations yet. Highlight text on the page to create one.');
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

      // Load outbox annotations for this page
      const outboxResponse = await browser.runtime.sendMessage({
        type: 'GET_OUTBOX_ANNOTATIONS',
        data: { url: currentTab.url },
      });
      currentOutboxAnnotations = outboxResponse.success ? outboxResponse.data : [];

      await displayPageStatus();

      // Query content script for which annotations couldn't be found
      if (LOG_LEVEL > 0) console.log('Webtero sidebar: Querying for not-found annotations, currentAnnotations.length:', currentAnnotations.length);
      if (currentTab?.id && currentAnnotations.length > 0) {
        try {
          if (LOG_LEVEL > 0) console.log('Webtero sidebar: Sending GET_NOT_FOUND_ANNOTATIONS to tab', currentTab.id);
          const notFoundResponse = await browser.tabs.sendMessage(currentTab.id, {
            type: 'GET_NOT_FOUND_ANNOTATIONS',
          });
          if (LOG_LEVEL > 0) console.log('Webtero sidebar: GET_NOT_FOUND_ANNOTATIONS response:', notFoundResponse);
          if (notFoundResponse?.success && notFoundResponse.data?.notFoundIds) {
            const notFoundIds = new Set(notFoundResponse.data.notFoundIds);
            if (LOG_LEVEL > 0) console.log('Webtero sidebar: Not found IDs:', Array.from(notFoundIds));
            currentAnnotations = currentAnnotations.map((ann) => ({
              ...ann,
              notFound: notFoundIds.has(ann.id),
            }));
            if (LOG_LEVEL > 0) console.log('Webtero sidebar: Updated annotations with notFound status');
          }
        } catch (error) {
          // Content script may not be loaded yet, ignore
          console.debug('Webtero sidebar: Could not query not-found annotations:', error);
        }
      }

      displayAnnotations(currentAnnotations, currentOutboxAnnotations);

      // Load links for this page
      loadLinks();

      // Enable focus tracking and link indicators for saved pages
      checkAndEnableTracking();
    } else {
      setPageStatusError(response.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Failed to load page data:', error);
    setPageStatusError('Failed to load page data');
  }
}

// Helper to set page status error message safely
function setPageStatusError(message: string) {
  pageStatus.textContent = '';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  pageStatus.appendChild(p);
}

// Helper to set an empty message on an element safely
function setEmptyMessage(element: HTMLElement, message: string) {
  element.textContent = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = message;
  element.appendChild(p);
}

// Display page status
async function displayPageStatus() {
  pageStatus.style.display = 'none';
  pageActions.style.display = 'block';

  // Reset page load time when displaying status
  pageLoadTime = new Date();

  // Load projects into the header dropdown
  await loadProjectsForDropdown();

  // If dropdown is on "My Library" and current page has projects, switch to page's project
  if (currentPage && currentPage.projects.length > 0 && projectDropdown.value === '') {
    // Get the most recently added project (pick the last one if multiple)
    const allProjects = await storage.getAllProjects();
    const pageProjectIds = currentPage.projects;

    // Sort page's projects by dateModified descending to get the most recent
    const sortedPageProjects = pageProjectIds
      .map((id) => allProjects[id])
      .filter((p) => p) // Filter out any missing projects
      .sort((a, b) => {
        const dateA = a.dateModified ? new Date(a.dateModified).getTime() : 0;
        const dateB = b.dateModified ? new Date(b.dateModified).getTime() : 0;
        return dateB - dateA;
      });

    if (sortedPageProjects.length > 0) {
      const mostRecentProject = sortedPageProjects[0];
      if (projectDropdown.querySelector(`option[value="${mostRecentProject.id}"]`)) {
        projectDropdown.value = mostRecentProject.id;
      }
    }
  }

  // Check if there's an outbox annotation currently saving the page
  const isSavingPage = currentOutboxAnnotations.some(
    (ann) => ann.status === 'saving_page' || ann.status === 'saving_annotation'
  );

  if (isSavingPage) {
    savePageBtn.disabled = true;
    savePageBtn.textContent = 'Saving...';
  } else {
    savePageBtn.disabled = false;
    savePageBtn.textContent = 'Save';
  }

  // Check if auto-save is enabled for this tab
  let isAutoSaveEnabled = false;
  if (currentTab?.id && cachedSettings.autoSaveEnabled) {
    try {
      const autoSaveResponse = await browser.runtime.sendMessage({
        type: 'CHECK_AUTO_SAVE',
        data: { tabId: currentTab.id },
      });
      isAutoSaveEnabled = autoSaveResponse.success && autoSaveResponse.data?.enabled;
    } catch {
      // Ignore errors checking auto-save state
    }
  }

  // Show/hide auto-save indicator
  autoSaveIcon.style.display = isAutoSaveEnabled ? 'inline' : 'none';

  // Check if auto-save is in progress for this URL (show progress bar)
  let isAutoSaveInProgress = false;
  if (currentTab?.url && isAutoSaveEnabled && !currentPage) {
    try {
      const saveStatusResponse = await browser.runtime.sendMessage({
        type: 'CHECK_SAVE_IN_PROGRESS',
        data: { url: currentTab.url },
      });
      isAutoSaveInProgress = saveStatusResponse.success && saveStatusResponse.data?.inProgress;
    } catch {
      // Ignore errors checking save status
    }
  }

  // Show saving progress if auto-save is in progress
  if (isAutoSaveInProgress) {
    saveProgress.style.display = 'flex';
    saveProgressFill.style.width = '50%'; // Indeterminate progress
    saveProgressText.textContent = 'Auto-saving...';
    savePageBtn.disabled = true;
    savePageBtn.textContent = 'Saving...';

    // Poll until save completes, then refresh page data
    pollAutoSaveCompletion(currentTab.url!);
  } else {
    // Only hide if we're not showing it for another reason
    if (!isSavingPage) {
      saveProgress.style.display = 'none';
    }
  }

  if (currentPage) {
    // Show saved state with versions
    savedInfo.style.display = 'block';
    savedIcon.style.display = 'inline';

    // Hide the redundant date/project text
    savedDate.style.display = 'none';
    savedProject.style.display = 'none';

    // Display versions list
    displayVersionsList();
    startLiveVersionTimer();

    // Update read progress
    await updateReadProgress();
    startReadProgressTimer();
  } else {
    // First time saving
    savedInfo.style.display = 'none';
    savedIcon.style.display = 'none';
    stopLiveVersionTimer();
    stopReadProgressTimer();

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
  // Set initial value
  liveVersionDate.textContent = getRelativeTime(pageLoadTime);
  liveVersionTimer = setInterval(() => {
    liveVersionDate.textContent = getRelativeTime(pageLoadTime);
  }, 10000); // Update every 10 seconds
}

// Stop the Live Version timer
function stopLiveVersionTimer() {
  if (liveVersionTimer) {
    clearInterval(liveVersionTimer);
    liveVersionTimer = null;
  }
}

// Start timer to periodically update read progress
function startReadProgressTimer() {
  stopReadProgressTimer();
  // Update every 5 seconds to catch when user returns to tab
  readProgressTimer = setInterval(() => {
    if (cachedSettings.readingProgressEnabled && currentPage?.zoteroItemKey) {
      updateReadProgress();
    }
  }, 5000);
}

// Stop the read progress timer
function stopReadProgressTimer() {
  if (readProgressTimer) {
    clearInterval(readProgressTimer);
    readProgressTimer = null;
  }
}

// Track active auto-save polling to avoid duplicates
let autoSavePollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Poll until auto-save completes for a URL, then refresh page data
 */
function pollAutoSaveCompletion(url: string) {
  // Clear any existing poll
  if (autoSavePollTimer) {
    clearInterval(autoSavePollTimer);
    autoSavePollTimer = null;
  }

  let pollCount = 0;
  const maxPolls = 60; // Max 60 seconds of polling

  autoSavePollTimer = setInterval(async () => {
    pollCount++;

    try {
      const response = await browser.runtime.sendMessage({
        type: 'CHECK_SAVE_IN_PROGRESS',
        data: { url },
      });

      const stillInProgress = response.success && response.data?.inProgress;

      if (!stillInProgress || pollCount >= maxPolls) {
        // Save completed or timed out - refresh page data
        if (autoSavePollTimer) {
          clearInterval(autoSavePollTimer);
          autoSavePollTimer = null;
        }

        // Hide progress and refresh
        saveProgress.style.display = 'none';
        savePageBtn.disabled = false;
        savePageBtn.textContent = 'Save';

        // Reload page data to show saved state
        await loadPageData();
      }
    } catch {
      // Error checking - stop polling and refresh anyway
      if (autoSavePollTimer) {
        clearInterval(autoSavePollTimer);
        autoSavePollTimer = null;
      }
      saveProgress.style.display = 'none';
      await loadPageData();
    }
  }, 1000); // Poll every second
}

// Display versions list (snapshots only - Live Version is always shown in HTML)
function displayVersionsList() {
  if (!currentPage) return;

  // Show/hide snapshots section based on whether there are any
  if (currentSnapshots.length > 0) {
    versionsSection.style.display = 'block';

    // Clear and rebuild versions list using DOM manipulation
    versionsList.textContent = '';

    for (const snapshot of currentSnapshots) {
      const versionDiv = document.createElement('div');
      versionDiv.className = 'version snapshot';
      versionDiv.dataset.key = snapshot.key;
      versionDiv.dataset.itemKey = currentPage?.zoteroItemKey || '';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'version-icon';
      iconSpan.textContent = '\u{1F4F7}'; // camera emoji

      const labelSpan = document.createElement('span');
      labelSpan.className = 'version-label';
      labelSpan.textContent = snapshot.title;

      const dateSpan = document.createElement('span');
      dateSpan.className = 'version-date';
      dateSpan.textContent = formatDate(snapshot.dateAdded);

      versionDiv.appendChild(iconSpan);
      versionDiv.appendChild(labelSpan);
      versionDiv.appendChild(dateSpan);

      // Add click handler
      versionDiv.addEventListener('click', () => {
        if (snapshot.key && currentPage?.zoteroItemKey) {
          openSnapshotInReader(currentPage.zoteroItemKey, snapshot.key);
        }
      });

      versionsList.appendChild(versionDiv);
    }

  } else {
    versionsSection.style.display = 'none';
  }
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
    const readerUrl = `https://www.zotero.org/${auth.username}/items/${itemKey}/attachment/${snapshotKey}/reader`;
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

  // Clear and rebuild dropdown using DOM manipulation
  projectDropdown.textContent = '';

  if (projectsArray.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No projects (click sync)';
    projectDropdown.appendChild(option);
    return;
  }

  // Build hierarchical sorted list
  const sortedProjects = buildHierarchicalProjectList(projectsArray);

  // Add default "My Library" option
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'My Library (no project)';
  projectDropdown.appendChild(defaultOption);

  // Add project options
  for (const p of sortedProjects) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = (p.parentId ? '\u00A0\u00A0' : '') + p.name;
    projectDropdown.appendChild(option);
  }

  // Restore previous selection if it still exists
  if (previousValue && projectDropdown.querySelector(`option[value="${previousValue}"]`)) {
    projectDropdown.value = previousValue;
  }
}

// Save page
savePageBtn.addEventListener('click', async () => {
  if (!currentTab?.url || !currentTab?.title) return;

  savePageBtn.disabled = true;
  savePageBtn.style.display = 'none';

  // Show progress bar
  saveProgress.style.display = 'flex';
  saveProgressFill.style.width = '0%';
  saveProgressText.textContent = 'Creating item...';

  // Animate progress through stages
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  let currentProgress = 0;

  const animateProgress = (targetProgress: number, text: string) => {
    saveProgressText.textContent = text;
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (currentProgress < targetProgress) {
        currentProgress += 1;
        saveProgressFill.style.width = `${currentProgress}%`;
      } else if (progressInterval) {
        clearInterval(progressInterval);
      }
    }, 30);
  };

  // Start progress animation
  animateProgress(20, 'Creating item...');

  try {
    const selectedProject = projectDropdown.value;
    const collections = selectedProject ? [selectedProject] : [];

    // Progress to capturing stage after short delay
    setTimeout(() => animateProgress(50, 'Capturing page...'), 500);

    const response = await browser.runtime.sendMessage({
      type: 'SAVE_PAGE',
      data: {
        url: currentTab.url,
        title: currentTab.title,
        collections,
      },
    });

    if (response.success) {
      // Complete the progress bar
      animateProgress(100, 'Saved!');

      const { itemKey } = response.data;

      // Enable auto-save mode and focus tracking for this tab
      if (currentTab.id && itemKey) {
        await enableAutoSaveAndTracking(currentTab.id, itemKey, currentTab.url);
      }

      // Wait for animation to complete before hiding
      setTimeout(async () => {
        saveProgress.style.display = 'none';
        savePageBtn.style.display = 'block';
        await loadPageData();
      }, 600);
    } else {
      if (progressInterval) clearInterval(progressInterval);
      saveProgress.style.display = 'none';
      savePageBtn.style.display = 'block';
      alert(`Failed to save page: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to save page:', error);
    if (progressInterval) clearInterval(progressInterval);
    saveProgress.style.display = 'none';
    savePageBtn.style.display = 'block';
    alert('Failed to save page');
  } finally {
    savePageBtn.disabled = false;
    savePageBtn.textContent = 'Save';
  }
});

// Display annotations (zotero-reader style)
function displayAnnotations(annotations: Annotation[], outboxAnnotations: OutboxAnnotation[] = []) {
  // Clear existing content
  annotationsList.textContent = '';

  if (annotations.length === 0 && outboxAnnotations.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty';
    emptyMsg.textContent = 'No annotations yet. Highlight text on the page to create one.';
    annotationsList.appendChild(emptyMsg);
    return;
  }

  // Render outbox annotations first (they're pending)
  const sortedOutbox = outboxAnnotations
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  for (const ann of sortedOutbox) {
    annotationsList.appendChild(renderOutboxAnnotationElement(ann));
  }

  // Then render saved annotations
  const sortedAnnotations = annotations
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  for (const ann of sortedAnnotations) {
    annotationsList.appendChild(renderAnnotationElement(ann));
  }

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

// Get snapshot title by key from currentSnapshots
function getSnapshotTitle(snapshotKey: string | undefined): string | null {
  if (!snapshotKey) return null;
  const snapshot = currentSnapshots.find((s) => s.key === snapshotKey);
  return snapshot?.title || null;
}

// Render a single annotation as DOM element (zotero-reader style)
function renderAnnotationElement(ann: Annotation): HTMLElement {
  const color = ann.color || 'yellow';
  const snapshotTitle = getSnapshotTitle(ann.snapshotKey);

  const container = document.createElement('div');
  container.className = `annotation${ann.notFound ? ' not-found' : ''}${ann.snapshotKey ? ' historical' : ''}`;
  container.dataset.id = ann.id;
  container.dataset.color = color;

  // Header
  const header = document.createElement('div');
  header.className = 'annotation-header';

  const startDiv = document.createElement('div');
  startDiv.className = 'start';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'annotation-icon';
  iconSpan.appendChild(createHighlightIcon());
  startDiv.appendChild(iconSpan);

  // Show snapshot badge if annotation is associated with a snapshot
  if (snapshotTitle) {
    const snapshotBadge = document.createElement('span');
    snapshotBadge.className = 'snapshot-badge';
    snapshotBadge.textContent = snapshotTitle;
    snapshotBadge.title = `From ${snapshotTitle}`;
    startDiv.appendChild(snapshotBadge);
  }

  const endDiv = document.createElement('div');
  endDiv.className = 'end';
  const optionsBtn = document.createElement('button');
  optionsBtn.className = 'annotation-options';
  optionsBtn.title = 'More options';
  optionsBtn.textContent = '\u2026'; // ellipsis
  endDiv.appendChild(optionsBtn);

  header.appendChild(startDiv);
  header.appendChild(endDiv);
  container.appendChild(header);

  // Not found warning
  if (ann.notFound) {
    const warning = document.createElement('div');
    warning.className = 'annotation-warning';
    warning.textContent = '\u26A0 Could not find this highlight on the current page';
    container.appendChild(warning);
  }

  // Annotation text
  const textDiv = document.createElement('div');
  textDiv.className = 'annotation-text';
  const border = document.createElement('div');
  border.className = 'blockquote-border';
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = ann.text;
  textDiv.appendChild(border);
  textDiv.appendChild(content);
  container.appendChild(textDiv);

  // Comment
  if (ann.comment) {
    const commentDiv = document.createElement('div');
    commentDiv.className = 'annotation-comment';
    commentDiv.textContent = ann.comment;
    container.appendChild(commentDiv);
  }

  // Meta
  const metaDiv = document.createElement('div');
  metaDiv.className = 'annotation-meta';
  const dateSpan = document.createElement('span');
  dateSpan.textContent = formatDate(ann.created);
  metaDiv.appendChild(dateSpan);

  if (!ann.snapshotKey) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-annotation';
    deleteBtn.dataset.id = ann.id;
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '\u00D7'; // multiplication sign (×)
    metaDiv.appendChild(deleteBtn);
  }

  container.appendChild(metaDiv);
  return container;
}

// Render an outbox annotation as DOM element (pending upload)
function renderOutboxAnnotationElement(ann: OutboxAnnotation): HTMLElement {
  const color = ann.color || 'yellow';
  const statusText = getOutboxStatusText(ann.status);
  const statusClass = ann.status === 'failed' ? 'outbox-failed' : 'outbox-pending';

  const container = document.createElement('div');
  container.className = `annotation outbox-annotation ${statusClass}`;
  container.dataset.outboxId = ann.id;
  container.dataset.color = color;

  // Header
  const header = document.createElement('div');
  header.className = 'annotation-header';

  const startDiv = document.createElement('div');
  startDiv.className = 'start';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'annotation-icon';
  iconSpan.appendChild(createHighlightIcon());
  const statusSpan = document.createElement('span');
  statusSpan.className = 'outbox-status';
  statusSpan.textContent = statusText;
  startDiv.appendChild(iconSpan);
  startDiv.appendChild(statusSpan);

  const endDiv = document.createElement('div');
  endDiv.className = 'end';
  if (ann.status === 'failed') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-outbox';
    retryBtn.dataset.id = ann.id;
    retryBtn.title = 'Retry';
    retryBtn.textContent = '\u21BB'; // refresh symbol
    endDiv.appendChild(retryBtn);
  }
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-outbox';
  deleteBtn.dataset.id = ann.id;
  deleteBtn.title = 'Cancel';
  deleteBtn.textContent = '\u00D7'; // multiplication sign (×)
  endDiv.appendChild(deleteBtn);

  header.appendChild(startDiv);
  header.appendChild(endDiv);
  container.appendChild(header);

  // Error warning
  if (ann.error) {
    const warning = document.createElement('div');
    warning.className = 'annotation-warning';
    warning.textContent = '\u26A0 ' + ann.error;
    container.appendChild(warning);
  }

  // Annotation text
  const textDiv = document.createElement('div');
  textDiv.className = 'annotation-text';
  const border = document.createElement('div');
  border.className = 'blockquote-border';
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = ann.text;
  textDiv.appendChild(border);
  textDiv.appendChild(content);
  container.appendChild(textDiv);

  // Comment
  if (ann.comment) {
    const commentDiv = document.createElement('div');
    commentDiv.className = 'annotation-comment';
    commentDiv.textContent = ann.comment;
    container.appendChild(commentDiv);
  }

  // Meta
  const metaDiv = document.createElement('div');
  metaDiv.className = 'annotation-meta';
  const dateSpan = document.createElement('span');
  dateSpan.textContent = formatDate(ann.created);
  metaDiv.appendChild(dateSpan);
  container.appendChild(metaDiv);

  return container;
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
refreshAnnotations.addEventListener('click', async () => {
  if (LOG_LEVEL > 0) console.log('Webtero sidebar: Refresh annotations clicked');

  // First, try to retry any not-found highlights in the content script
  if (currentTab?.id) {
    try {
      if (LOG_LEVEL > 0) console.log('Webtero sidebar: Sending RETRY_NOT_FOUND_HIGHLIGHTS to tab', currentTab.id);
      const retryResult = await browser.tabs.sendMessage(currentTab.id, {
        type: 'RETRY_NOT_FOUND_HIGHLIGHTS',
      });
      if (LOG_LEVEL > 0) console.log('Webtero sidebar: RETRY_NOT_FOUND_HIGHLIGHTS result:', retryResult);
    } catch (error) {
      // Content script may not be loaded, ignore
      console.debug('Webtero sidebar: Could not retry not-found highlights:', error);
    }
  }

  // Then reload the page data to refresh the UI
  if (LOG_LEVEL > 0) console.log('Webtero sidebar: Calling loadPageData after retry');
  await loadPageData();
});

// Load and display projects
async function loadProjects() {
  const projects = await storage.getAllProjects();
  const projectsArray = Object.values(projects);

  // Clear existing content
  projectsList.textContent = '';

  if (projectsArray.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty';
    emptyMsg.textContent = 'No projects. Click sync to load from Zotero.';
    projectsList.appendChild(emptyMsg);
    return;
  }

  // Build hierarchical sorted list
  const sortedProjects = buildHierarchicalProjectList(projectsArray);

  for (const p of sortedProjects) {
    const projectDiv = document.createElement('div');
    projectDiv.className = 'project';
    projectDiv.dataset.id = p.id;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'project-name';
    nameDiv.textContent = (p.parentId ? '\u00A0\u00A0' : '') + p.name;

    const countDiv = document.createElement('div');
    countDiv.className = 'project-count';
    countDiv.textContent = String(p.itemCount);

    projectDiv.appendChild(nameDiv);
    projectDiv.appendChild(countDiv);

    // Add click handler to select project in dropdown
    projectDiv.addEventListener('click', () => {
      projectDropdown.value = p.id;
    });

    projectsList.appendChild(projectDiv);
  }
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

  // Clear and rebuild parent project dropdown using DOM manipulation
  parentProject.textContent = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'No parent (top-level)';
  parentProject.appendChild(defaultOption);

  for (const p of projectsArray.filter((p) => !p.parentId)) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    parentProject.appendChild(option);
  }

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

// Read progress click - set to 100% read
readProgress?.addEventListener('click', async () => {
  if (!currentPage?.zoteroItemKey) return;

  try {
    const response = await browser.runtime.sendMessage({
      type: 'SET_READ_PERCENTAGE',
      data: { itemKey: currentPage.zoteroItemKey, percentage: 100 },
    });

    if (response.success) {
      // Update the UI immediately
      readProgressFill.style.width = '100%';
      readProgressText.textContent = '100% read';
    }
  } catch (error) {
    console.error('Failed to set read percentage:', error);
  }
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
 * Each message to the content script is wrapped separately since it may not be loaded yet
 */
async function enableAutoSaveAndTracking(tabId: number, itemKey: string, url: string) {
  // Enable auto-save in background (only if setting is enabled)
  if (cachedSettings.autoSaveEnabled) {
    try {
      await browser.runtime.sendMessage({
        type: 'ENABLE_AUTO_SAVE',
        data: { tabId, sourceItemKey: itemKey, sourceUrl: url },
      });
    } catch (error) {
      console.debug('Failed to enable auto-save in background:', error);
    }

    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'ENABLE_AUTO_SAVE_MODE',
        data: { itemKey },
      });
    } catch {
      // Content script may not be loaded yet - this is fine, it will check on load
    }
  }

  // Tell content script to start focus tracking (if enabled)
  if (cachedSettings.readingProgressEnabled) {
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'START_FOCUS_TRACKING',
        data: { itemKey },
      });
    } catch {
      // Content script may not be loaded yet
    }
  }

  // Enable link indicators (if enabled)
  if (cachedSettings.linkIndicatorsEnabled) {
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'ENABLE_LINK_INDICATORS',
      });
    } catch {
      // Content script may not be loaded yet
    }
  }

  if (LOG_LEVEL > 0) console.log('Auto-save and tracking enabled for tab', tabId);
}

/**
 * Update the read progress indicator
 */
async function updateReadProgress() {
  // Hide if reading progress is disabled or no page
  if (!cachedSettings.readingProgressEnabled || !currentPage?.zoteroItemKey) {
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
    // Start focus tracking for saved pages (if enabled)
    if (cachedSettings.readingProgressEnabled) {
      await browser.tabs.sendMessage(currentTab.id, {
        type: 'START_FOCUS_TRACKING',
        data: { itemKey: currentPage.zoteroItemKey },
      });
    }

    // Enable link indicators (if enabled)
    if (cachedSettings.linkIndicatorsEnabled) {
      await browser.tabs.sendMessage(currentTab.id, {
        type: 'ENABLE_LINK_INDICATORS',
      });
    }
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
  title?: string;
  direction: 'outgoing' | 'incoming';
  readPercentage: number;
  annotationColors: string[];
}

/**
 * Load and display links for the current page
 * Shows all outbound links that point to saved pages
 */
async function loadLinks() {
  if (!currentTab?.id) {
    setEmptyMessage(linksList, 'No active tab.');
    return;
  }

  try {
    // Get all outbound links from the content script (with retry for slow-loading pages)
    let pageLinks: Array<{ url: string; text: string }> = [];
    const linksResponse = await sendMessageToContentScript<{ success: boolean; data?: typeof pageLinks }>(
      currentTab.id,
      { type: 'GET_PAGE_LINKS_LIST' },
      3, // max retries
      200 // initial delay ms (200ms -> 400ms -> 800ms)
    );
    if (linksResponse?.success) {
      pageLinks = linksResponse.data || [];
    }

    // Get all saved URLs with their data
    const savedUrlsResponse = await browser.runtime.sendMessage({
      type: 'GET_SAVED_URLS',
    });

    if (!savedUrlsResponse.success) {
      setEmptyMessage(linksList, 'Failed to load saved pages.');
      return;
    }

    const savedUrls = savedUrlsResponse.data as Array<{
      url: string;
      itemKey: string;
      readPercentage: number;
      annotationColors: string[];
    }>;

    // Create a map of normalized URLs to saved data
    const savedUrlMap = new Map<string, typeof savedUrls[0]>();
    for (const saved of savedUrls) {
      savedUrlMap.set(normalizeUrlForSidebar(saved.url), saved);
    }

    // Current page URL for filtering
    const currentPageUrl = currentTab.url ? normalizeUrlForSidebar(currentTab.url) : '';

    // Find outbound links that point to saved pages
    const outboundLinks: LinkedPage[] = [];
    const seenUrls = new Set<string>();

    for (const link of pageLinks) {
      const normalizedUrl = normalizeUrlForSidebar(link.url);

      // Skip current page and duplicates
      if (normalizedUrl === currentPageUrl || seenUrls.has(normalizedUrl)) {
        continue;
      }

      const savedData = savedUrlMap.get(normalizedUrl);
      if (savedData) {
        seenUrls.add(normalizedUrl);
        outboundLinks.push({
          itemKey: savedData.itemKey,
          url: savedData.url,
          title: link.text || undefined,
          direction: 'outgoing',
          readPercentage: savedData.readPercentage,
          annotationColors: savedData.annotationColors,
        });
      }
    }

    displayLinks(outboundLinks);
  } catch (error) {
    console.error('Failed to load links:', error);
    setEmptyMessage(linksList, 'Failed to load links.');
  }
}

/**
 * Normalize URL for comparison in sidebar
 */
function normalizeUrlForSidebar(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    let path = parsed.pathname;
    if (path.endsWith('/') && path.length > 1) {
      path = path.slice(0, -1);
    }
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Build HTML for annotation color blocks in links section
 */
function buildColorBlocksHtml(colors: string[]): string {
  if (colors.length === 0) return '';

  const colorMap: Record<string, string> = {
    yellow: '#ffd400',
    red: '#ff6666',
    green: '#5fb236',
    blue: '#2ea8e5',
    purple: '#a28ae5',
    magenta: '#e56eee',
    orange: '#f19837',
    gray: '#aaaaaa',
  };

  const blocks = colors.map((color) => {
    const bgColor = colorMap[color] || '#999';
    return `<span class="color-block" style="background:${bgColor}"></span>`;
  }).join('');

  return ` ${blocks}`;
}

/**
 * Display linked pages
 */
function displayLinks(links: LinkedPage[]) {
  // Clear existing content
  linksList.textContent = '';

  if (links.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty';
    emptyMsg.textContent = 'No outbound links to saved pages found.';
    linksList.appendChild(emptyMsg);
    return;
  }

  const linkGroup = document.createElement('div');
  linkGroup.className = 'link-group';

  const header = document.createElement('h4');
  header.textContent = 'Links to saved pages';
  linkGroup.appendChild(header);

  const colorMap: Record<string, string> = {
    yellow: '#ffd400',
    red: '#ff6666',
    green: '#5fb236',
    blue: '#2ea8e5',
    purple: '#a28ae5',
    magenta: '#e56eee',
    orange: '#f19837',
    gray: '#aaaaaa',
  };

  for (const link of links) {
    const linkItem = document.createElement('div');
    linkItem.className = 'link-item';
    linkItem.dataset.url = link.url;

    // Create indicator span
    const indicator = document.createElement('span');
    indicator.className = 'link-indicator';
    // Only show percentage if reading progress is enabled
    if (cachedSettings.readingProgressEnabled) {
      indicator.appendChild(document.createTextNode(`[wt ${link.readPercentage}%`));
    } else {
      indicator.appendChild(document.createTextNode('[wt'));
    }

    // Add color blocks
    if (link.annotationColors.length > 0) {
      if (!cachedSettings.readingProgressEnabled) {
        indicator.appendChild(document.createTextNode(' '));
      }
      for (const color of link.annotationColors) {
        const block = document.createElement('span');
        block.className = 'color-block';
        block.style.background = colorMap[color] || '#999';
        indicator.appendChild(block);
      }
    }

    indicator.appendChild(document.createTextNode(']'));

    // Create URL span
    const urlSpan = document.createElement('span');
    urlSpan.className = 'link-url';
    urlSpan.title = link.url;
    // Use title only if it's meaningful (more than 5 chars and less than 60)
    const displayText = link.title && link.title.length > 5 && link.title.length < 60
      ? link.title
      : truncateUrl(link.url);
    urlSpan.textContent = displayText;

    linkItem.appendChild(indicator);
    linkItem.appendChild(urlSpan);

    // Add click handler
    linkItem.addEventListener('click', () => {
      browser.tabs.create({ url: link.url });
    });

    linkGroup.appendChild(linkItem);
  }

  linksList.appendChild(linkGroup);
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
  // Load settings first
  cachedSettings = await storage.getSettings();

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

// Listen for storage changes (e.g., credentials cleared from options page)
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.auth) {
    // Auth data changed - re-check authentication
    checkAuthAndInitialize();
  }
  if (areaName === 'local' && changes.settings) {
    // Settings changed - reload cached settings
    storage.getSettings().then((settings) => {
      cachedSettings = settings;
      // Refresh page data to apply new settings
      loadPageData();
    });
  }
});

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
