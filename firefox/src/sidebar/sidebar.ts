import type { SavedPage, Annotation, Project } from '../lib/types';
import { storage } from '../lib/storage';
import { formatDate, getColorValue } from '../lib/utils';

// DOM elements
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const pageStatus = document.getElementById('pageStatus') as HTMLDivElement;
const pageActions = document.getElementById('pageActions') as HTMLDivElement;
const savedInfo = document.getElementById('savedInfo') as HTMLDivElement;
const savedDate = document.getElementById('savedDate') as HTMLParagraphElement;
const saveForm = document.getElementById('saveForm') as HTMLDivElement;
const projectSelect = document.getElementById('projectSelect') as HTMLSelectElement;
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

let currentTab: browser.tabs.Tab | null = null;
let currentPage: SavedPage | null = null;

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

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_PAGE_DATA',
      data: { url: currentTab.url },
    });

    if (response.success) {
      currentPage = response.data.page;
      displayPageStatus();
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
function displayPageStatus() {
  pageStatus.style.display = 'none';
  pageActions.style.display = 'block';

  if (currentPage) {
    savedInfo.style.display = 'block';
    saveForm.style.display = 'none';
    savedDate.textContent = `Added ${formatDate(currentPage.dateAdded)}`;
  } else {
    savedInfo.style.display = 'none';
    saveForm.style.display = 'block';
    loadProjectsForSelect();
  }
}

// Load projects into select
async function loadProjectsForSelect() {
  const projects = await storage.getAllProjects();
  const projectsArray = Object.values(projects);

  if (projectsArray.length === 0) {
    projectSelect.innerHTML = '<option value="">No projects (click sync)</option>';
    return;
  }

  projectSelect.innerHTML = projectsArray
    .map(
      (p) =>
        `<option value="${p.id}">${p.parentId ? '  ' : ''}${p.name}</option>`
    )
    .join('');
}

// Save page
savePageBtn.addEventListener('click', async () => {
  if (!currentTab?.url || !currentTab?.title) return;

  savePageBtn.disabled = true;
  savePageBtn.textContent = 'Saving...';

  try {
    const selectedProjects = Array.from(projectSelect.selectedOptions).map(
      (opt) => opt.value
    );

    const response = await browser.runtime.sendMessage({
      type: 'SAVE_PAGE',
      data: {
        url: currentTab.url,
        title: currentTab.title,
        collections: selectedProjects,
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

// Display annotations
function displayAnnotations(annotations: Annotation[]) {
  if (annotations.length === 0) {
    annotationsList.innerHTML =
      '<p class="empty">No annotations yet. Highlight text on the page to create one.</p>';
    return;
  }

  annotationsList.innerHTML = annotations
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .map(
      (ann) => `
      <div class="annotation" data-id="${ann.id}" style="border-left: 4px solid ${getColorValue(ann.color)}">
        <div class="annotation-text">"${escapeHtml(ann.text)}"</div>
        ${ann.comment ? `<div class="annotation-comment">${escapeHtml(ann.comment)}</div>` : ''}
        <div class="annotation-meta">
          ${formatDate(ann.created)}
          <button class="delete-annotation" data-id="${ann.id}">×</button>
        </div>
      </div>
    `
    )
    .join('');

  // Add delete handlers
  document.querySelectorAll('.delete-annotation').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id && confirm('Delete this annotation?')) {
        await deleteAnnotation(id);
      }
    });
  });
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
        <div class="project-name">${p.parentId ? '  ' : ''}${escapeHtml(p.name)}</div>
        <div class="project-count">${p.itemCount}</div>
      </div>
    `
    )
    .join('');
}

// Sync projects
syncProjects.addEventListener('click', async () => {
  syncProjects.disabled = true;
  syncProjects.textContent = '⟳';

  try {
    const response = await browser.runtime.sendMessage({
      type: 'SYNC_PROJECTS',
    });

    if (response.success) {
      await loadProjects();
      await loadProjectsForSelect();
    } else {
      alert(`Failed to sync projects: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to sync projects:', error);
    alert('Failed to sync projects');
  } finally {
    syncProjects.disabled = false;
    syncProjects.textContent = '↻';
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
