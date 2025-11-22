import type { SavedPage, Annotation, Project } from '../lib/types';
import { storage } from '../lib/storage';
import { formatDate } from '../lib/utils';

// DOM elements
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const pageStatus = document.getElementById('pageStatus') as HTMLDivElement;
const pageActions = document.getElementById('pageActions') as HTMLDivElement;
const savedInfo = document.getElementById('savedInfo') as HTMLDivElement;
const savedDate = document.getElementById('savedDate') as HTMLParagraphElement;
const savedProject = document.getElementById('savedProject') as HTMLParagraphElement;
const savedIcon = document.getElementById('savedIcon') as HTMLSpanElement;
const saveForm = document.getElementById('saveForm') as HTMLDivElement;
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

let currentTab: browser.tabs.Tab | null = null;
let currentPage: SavedPage | null = null;

// Highlight icon SVG (from zotero-reader)
const HIGHLIGHT_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.7 13.4c-.1.1-.2.3-.2.5 0 .4.3.7.7.7.2 0 .4-.1.5-.2l5.8-5.8-1-1-5.8 5.8zM13 3.9l-.9-.9c-.4-.4-1-.4-1.4 0l-1.2 1.2 2.3 2.3 1.2-1.2c.4-.4.4-1 0-1.4zM4.5 7.7l2.3 2.3 4.6-4.6-2.3-2.3-4.6 4.6z"/></svg>`;

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

  // Check if on Zotero reader page
  handleZoteroReaderPage(currentTab.url);

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_PAGE_DATA',
      data: { url: currentTab.url },
    });

    if (response.success) {
      currentPage = response.data.page;
      await displayPageStatus();
      displayAnnotations(response.data.annotations);
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

  if (currentPage) {
    // Show saved state
    savedInfo.style.display = 'block';
    saveForm.style.display = 'none';
    savedIcon.style.display = 'inline';
    savedDate.textContent = `Added ${formatDate(currentPage.dateAdded)}`;

    // Display project name(s) the page was saved to
    if (currentPage.projects.length > 0) {
      const projects = await storage.getAllProjects();
      const projectNames = currentPage.projects
        .map((id) => projects[id]?.name)
        .filter(Boolean)
        .join(', ');
      savedProject.textContent = projectNames ? `in ${projectNames}` : '';
    } else {
      savedProject.textContent = 'in My Library';
    }
  } else {
    // Show save form
    savedInfo.style.display = 'none';
    saveForm.style.display = 'block';
    savedIcon.style.display = 'none';
    await loadProjectsForDropdown();
  }
}

// Load projects into dropdown
async function loadProjectsForDropdown() {
  const projects = await storage.getAllProjects();
  const projectsArray = Object.values(projects);

  if (projectsArray.length === 0) {
    projectDropdown.innerHTML = '<option value="">No projects (click sync)</option>';
    return;
  }

  // Sort projects: top-level first, then by name
  projectsArray.sort((a, b) => {
    if (a.parentId && !b.parentId) return 1;
    if (!a.parentId && b.parentId) return -1;
    return a.name.localeCompare(b.name);
  });

  projectDropdown.innerHTML =
    '<option value="">My Library (no project)</option>' +
    projectsArray
      .map(
        (p) =>
          `<option value="${p.id}">${p.parentId ? '\u00A0\u00A0' : ''}${escapeHtml(p.name)}</option>`
      )
      .join('');
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
      await loadPageData();
    } else {
      alert(`Failed to save page: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to save page:', error);
    alert('Failed to save page');
  } finally {
    savePageBtn.disabled = false;
    savePageBtn.textContent = 'Save to Zotero';
  }
});

// Display annotations (zotero-reader style)
function displayAnnotations(annotations: Annotation[]) {
  if (annotations.length === 0) {
    annotationsList.innerHTML =
      '<p class="empty">No annotations yet. Highlight text on the page to create one.</p>';
    return;
  }

  annotationsList.innerHTML = annotations
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .map((ann) => renderAnnotation(ann))
    .join('');

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
}

// Render a single annotation in zotero-reader style
function renderAnnotation(ann: Annotation): string {
  const color = ann.color || 'yellow';

  return `
    <div class="annotation" data-id="${ann.id}" data-color="${color}">
      <div class="annotation-header">
        <div class="start">
          <span class="annotation-icon">${HIGHLIGHT_ICON}</span>
        </div>
        <div class="end">
          <button class="annotation-options" title="More options">&#8230;</button>
        </div>
      </div>
      <div class="annotation-text">
        <div class="blockquote-border"></div>
        <div class="content">${escapeHtml(ann.text)}</div>
      </div>
      ${ann.comment ? `<div class="annotation-comment">${escapeHtml(ann.comment)}</div>` : ''}
      <div class="annotation-meta">
        <span>${formatDate(ann.created)}</span>
        <button class="delete-annotation" data-id="${ann.id}" title="Delete">&#215;</button>
      </div>
    </div>
  `;
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

  // Sort by name, with top-level first
  projectsArray.sort((a, b) => {
    if (a.parentId && !b.parentId) return 1;
    if (!a.parentId && b.parentId) return -1;
    return a.name.localeCompare(b.name);
  });

  projectsList.innerHTML = projectsArray
    .map(
      (p) => `
      <div class="project" data-id="${p.id}">
        <div class="project-name">${p.parentId ? '\u00A0\u00A0' : ''}${escapeHtml(p.name)}</div>
        <div class="project-count">${p.itemCount}</div>
      </div>
    `
    )
    .join('');
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

// Initialize
loadPageData();
loadProjects();

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
});
