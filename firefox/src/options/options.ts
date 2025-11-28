import { storage } from '../lib/storage';

// Zotero elements
const form = document.getElementById('authForm') as HTMLFormElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const userIDInput = document.getElementById('userID') as HTMLInputElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const zoteroSyncSection = document.getElementById('zoteroSyncSection') as HTMLDivElement;
const syncProjectsBtn = document.getElementById('syncProjectsBtn') as HTMLButtonElement;
const syncStatus = document.getElementById('syncStatus') as HTMLDivElement;
const oauthSignInBtn = document.getElementById('oauthSignInBtn') as HTMLButtonElement;
const oauthError = document.getElementById('oauthError') as HTMLParagraphElement;

// Settings elements
const sidebarProjectSelectHeight = document.getElementById('sidebarProjectSelectHeight') as HTMLInputElement;
const linkIndicatorsCheckbox = document.getElementById('linkIndicatorsEnabled') as HTMLInputElement;
const readingProgressCheckbox = document.getElementById('readingProgressEnabled') as HTMLInputElement;
const autoSaveCheckbox = document.getElementById('autoSaveEnabled') as HTMLInputElement;
const settingsStatus = document.getElementById('settingsStatus') as HTMLDivElement;

// Atlos elements
const formAtlos = document.getElementById('authAtlosForm') as HTMLFormElement;
const atlasProjectNameInput = document.getElementById('atlasProjectName') as HTMLInputElement;
const apiKeyAtlosInput = document.getElementById('apiKeyAtlos') as HTMLInputElement;
const atlosCredentialsBody = document.getElementById('atlosCredentialsBody') as HTMLTableSectionElement;
const atlosSyncSection = document.getElementById('atlosSyncSection') as HTMLDivElement;
const statusAtlosDiv = document.getElementById('statusAtlos') as HTMLDivElement;
const syncStatusAtlos = document.getElementById('syncStatusAtlos') as HTMLDivElement;
const syncProjectsAtlosBtn = document.getElementById('syncProjectsAtlosBtn') as HTMLButtonElement;

// Load existing credentials
async function loadCredentials() {
  const auth = await storage.getAuth();
  if (auth) {
    usernameInput.value = auth.username || '';
    apiKeyInput.value = maskKey(auth.apiKey);
    userIDInput.value = auth.userID;
    zoteroSyncSection.style.display = 'block';
  } else {
    zoteroSyncSection.style.display = 'none';
  }

  // Load Atlos credentials into table
  await loadAtlosCredentialsTable();
}

function maskKey(key: string): string {
  const maskLength = key.length - 4;
  return key.substring(0, 4) + '*'.repeat(maskLength);
}

// Load Atlos credentials table
async function loadAtlosCredentialsTable() {
  const allAuthAtlos = await storage.getAllAuthAtlos();

  // Clear existing rows
  atlosCredentialsBody.textContent = '';

  if (allAuthAtlos.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 3;
    emptyCell.textContent = 'No Atlos credentials saved yet.';
    emptyCell.style.textAlign = 'center';
    emptyCell.style.fontStyle = 'italic';
    emptyRow.appendChild(emptyCell);
    atlosCredentialsBody.appendChild(emptyRow);
    return;
  }

  // Add a row for each credential
  for (const auth of allAuthAtlos) {
    const row = document.createElement('tr');

    // Project Name cell (editable)
    const nameCell = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = auth.projectName;
    nameInput.dataset.oldProjectName = auth.projectName;
    nameInput.addEventListener('blur', () => handleProjectNameEdit(nameInput));
    nameCell.appendChild(nameInput);

    // API Key cell (masked, editable)
    const keyCell = document.createElement('td');
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.value = maskKey(auth.apiKey);
    keyInput.dataset.projectName = auth.projectName;
    keyInput.addEventListener('focus', () => {
      if (keyInput.value.includes('*')) {
        keyInput.value = '';
        keyInput.placeholder = 'Enter new API key...';
      }
    });
    keyInput.addEventListener('blur', () => handleApiKeyEdit(keyInput));
    keyCell.appendChild(keyInput);

    // Actions cell (remove button)
    const actionsCell = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove this project';
    removeBtn.className = 'remove-btn';
    removeBtn.addEventListener('click', () => handleRemoveAtlos(auth.projectName));
    actionsCell.appendChild(removeBtn);

    row.appendChild(nameCell);
    row.appendChild(keyCell);
    row.appendChild(actionsCell);
    atlosCredentialsBody.appendChild(row);
  }
}

// Handle project name edit
async function handleProjectNameEdit(input: HTMLInputElement) {
  const newName = input.value.trim();
  const oldName = input.dataset.oldProjectName || '';

  if (!newName) {
    showStatusAtlos('Project name cannot be empty.', true);
    input.value = oldName;
    return;
  }

  if (newName === oldName) {
    return; // No change
  }

  // Check if new name already exists
  const existing = await storage.getAuthAtlosByProject(newName);
  if (existing) {
    showStatusAtlos(`Project name "${newName}" already exists. Please use a different name.`, true);
    input.value = oldName;
    return;
  }

  // Get the old auth entry
  const oldAuth = await storage.getAuthAtlosByProject(oldName);
  if (!oldAuth) {
    showStatusAtlos('Failed to find original project.', true);
    input.value = oldName;
    return;
  }

  // Remove old entry and add new one with updated name
  await storage.removeAuthAtlos(oldName);
  await storage.addAuthAtlos({ apiKey: oldAuth.apiKey, projectName: newName });

  // Update the data attribute
  input.dataset.oldProjectName = newName;

  // Update any API key inputs that reference this project
  const keyInputs = atlosCredentialsBody.querySelectorAll('input[data-project-name]');
  keyInputs.forEach((keyInput) => {
    if ((keyInput as HTMLInputElement).dataset.projectName === oldName) {
      (keyInput as HTMLInputElement).dataset.projectName = newName;
    }
  });
  setTimeout(async () => {
    await browser.runtime.sendMessage({
      type: 'PROJECTS_UPDATED',
    });
  }, 500);

  showStatusAtlos(`Project renamed from "${oldName}" to "${newName}".`);
}

// Handle API key edit
async function handleApiKeyEdit(input: HTMLInputElement) {
  const projectName = input.dataset.projectName || '';
  const newKey = input.value.trim();

  if (!newKey) {
    // User cleared the field, restore masked key
    const auth = await storage.getAuthAtlosByProject(projectName);
    if (auth) {
      input.value = maskKey(auth.apiKey);
    }
    return;
  }

  if (newKey.includes('*')) {
    // Still masked, no change
    return;
  }

  // Get existing auth
  const existingAuth = await storage.getAuthAtlosByProject(projectName);
  if (!existingAuth) {
    showStatusAtlos('Failed to find project.', true);
    return;
  }

  // Update with new API key
  await storage.addAuthAtlos({ apiKey: newKey, projectName });

  // Mask the key
  input.value = maskKey(newKey);

  showStatusAtlos(`API key updated for "${projectName}".`);
  await browser.runtime.sendMessage({
    type: 'PROJECTS_UPDATED',
  });
}

// Handle remove Atlos project
async function handleRemoveAtlos(projectName: string) {
  if (!confirm(`Are you sure you want to remove credentials for "${projectName}"?`)) {
    return;
  }

  try {
    await storage.removeAuthAtlos(projectName);
    await loadAtlosCredentialsTable();
    showStatusAtlos(`Removed credentials for "${projectName}".`);
    await browser.runtime.sendMessage({
      type: 'PROJECTS_UPDATED',
    });
  } catch (error) {
    showStatusAtlos(`Failed to remove credentials for "${projectName}".`, true);
    console.error(error);
  }
}

// Load existing settings
async function loadSettings() {
  const settings = await storage.getSettings();
  linkIndicatorsCheckbox.checked = settings.linkIndicatorsEnabled;
  readingProgressCheckbox.checked = settings.readingProgressEnabled;
  autoSaveCheckbox.checked = settings.autoSaveEnabled;
  sidebarProjectSelectHeight.value = settings.sidebarProjectSelectHeight.toString();
}

// Show Zotero status message
function showStatus(message: string, isError: boolean = false) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${isError ? 'error' : 'success'}`;

  statusDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  statusDiv.focus();

  setTimeout(() => {
    statusDiv.className = 'status';
  }, 3000);
}

// Show Atlos status message
function showStatusAtlos(message: string, isError: boolean = false) {
  statusAtlosDiv.textContent = message;
  statusAtlosDiv.className = `status ${isError ? 'error' : 'success'}`;

  statusAtlosDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  statusAtlosDiv.focus();

  setTimeout(() => {
    statusAtlosDiv.className = 'statusAtlos';
  }, 6000);
}

// Show Zotero sync status
function showSyncStatus(message: string, type: 'success' | 'error' | 'loading') {
  syncStatus.textContent = message;
  syncStatus.className = `sync-status visible ${type}`;

  syncStatus.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  syncStatus.focus();

  if (type !== 'loading') {
    setTimeout(() => {
      syncStatus.className = 'sync-status';
    }, 5000);
  }
}

// Show Atlos sync status
function showSyncStatusAtlos(message: string, type: 'success' | 'error' | 'loading') {
  syncStatusAtlos.textContent = message;
  syncStatusAtlos.className = `sync-status visible ${type}`;

  syncStatusAtlos.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  syncStatusAtlos.focus();

  if (type !== 'loading') {
    setTimeout(() => {
      syncStatusAtlos.className = 'sync-status';
    }, 5000);
  }
}

// Show Settings Status
function showSettingsStatus(message: string, type: 'success' | 'error' | 'loading') {
  settingsStatus.textContent = message;
  settingsStatus.className = `settings-status visible ${type}`;

  settingsStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
  settingsStatus.focus();

  if (type !== 'loading') {
    setTimeout(() => {
      settingsStatus.className = 'settings-status';
    }, 5000);
  }
}


// Save Zotero credentials
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const apiKey = apiKeyInput.value.trim();
  const userID = userIDInput.value.trim();

  if (!apiKey) {
    showStatus('Please enter an API key. Key removed from device storage.', true);
    await storage.clearAuth();
    return;
  }

  if (apiKey.indexOf("*") !== -1) {
    showStatus('API key appears to be masked. Please enter the full API key or clear out its value and save again.', true);
    return;
  }

  try {
    await storage.setAuth({ apiKey, userID });
    showStatus('Credentials saved successfully!');

    apiKeyInput.value = maskKey(apiKey);
  } catch (error) {
    showStatus('Failed to save credentials', true);
    console.error(error);
  }
});

// Save Atlos credentials
formAtlos.addEventListener('submit', async (e) => {
  e.preventDefault();

  const projectName = atlasProjectNameInput.value.trim();
  const apiKey = apiKeyAtlosInput.value.trim();

  if (!projectName || !apiKey) {
    showStatusAtlos('Both project name and API key are required.', true);
    return;
  }

  if (apiKey.includes('*')) {
    showStatusAtlos('API key appears to be masked. Please enter the full API key.', true);
    return;
  }

  try {
    await storage.addAuthAtlos({ projectName, apiKey });
    showStatusAtlos(`Credentials saved for "${projectName}"!`);

    // Clear form
    atlasProjectNameInput.value = '';
    apiKeyAtlosInput.value = '';

    // Reload table
    await loadAtlosCredentialsTable();
  } catch (error) {
    showStatusAtlos('Failed to save credentials', true);
    console.error(error);
  }
});

// Clear credentials
clearBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear your credentials?')) {
    try {
      await storage.clearAuth();
      usernameInput.value = '';
      apiKeyInput.value = '';
      userIDInput.value = '';
      showStatus('Credentials cleared');
    } catch (error) {
      showStatus('Failed to clear credentials', true);
      console.error(error);
    }
  }
});

// Sync Zotero projects
syncProjectsBtn.addEventListener('click', async () => {
  syncProjectsBtn.disabled = true;
  showSyncStatus('Syncing projects...', 'loading');

  try {
    const response = await browser.runtime.sendMessage({
      type: 'SYNC_PROJECTS_ZOTERO',
    });

    if (response.success) {
      const count = response.data ? Object.keys(response.data).length : 0;
      showSyncStatus(`Synced ${count} incidents${count === 1 ? '' : 's'} successfully!`, 'success');
      await browser.runtime.sendMessage({
        type: 'PROJECTS_UPDATED',
      });
    } else {
      showSyncStatus(`Sync failed: ${response.error || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('Failed to sync projects:', error);
    showSyncStatus('Failed to sync projects', 'error');
  } finally {
    syncProjectsBtn.disabled = false;
  }
});

// Sync Atlos projects
syncProjectsAtlosBtn.addEventListener('click', async () => {
  syncProjectsAtlosBtn.disabled = true;
  showSyncStatusAtlos('Syncing Atlos projects...', 'loading');

  try {
    const response = await browser.runtime.sendMessage({
      type: 'SYNC_PROJECTS_ATLOS',
    });

    if (response.success) {
      const count = 2;
      showSyncStatusAtlos(`Synced Atlos project${count === 1 ? '' : 's'} successfully!`, 'success');
      await browser.runtime.sendMessage({
        type: 'PROJECTS_UPDATED',
      });
    } else {
      showSyncStatusAtlos(`Sync failed: ${response.error || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('Failed to sync Atlos projects:', error);
    showSyncStatusAtlos('Failed to sync Atlos projects', 'error');
  } finally {
    syncProjectsAtlosBtn.disabled = false;
  }
});

// Save settings when value changes
sidebarProjectSelectHeight.addEventListener('change', async () => {
  try {
    await storage.updateSettings({
      sidebarProjectSelectHeight: parseInt(sidebarProjectSelectHeight.value, 10),
    });
    showSettingsStatus('Sidebar project select height setting saved.', 'success');
    await browser.runtime.sendMessage({
      type: 'PROJECTS_UPDATED',
    });
  } catch (error) {
    console.error('Failed to save sidebar project select height setting:', error);
    showSettingsStatus('Failed to save sidebar project select height setting.', 'error');
  }
});


// Save settings when toggles change
linkIndicatorsCheckbox.addEventListener('change', async () => {
  try {
    await storage.updateSettings({
      linkIndicatorsEnabled: linkIndicatorsCheckbox.checked,
    });
    showSettingsStatus('Link indicator setting saved.', 'success');
  } catch (error) {
    console.error('Failed to save link indicators setting:', error);
    showSettingsStatus('Failed to save link indicator setting.', 'error');
  }
});

readingProgressCheckbox.addEventListener('change', async () => {
  try {
    await storage.updateSettings({
      readingProgressEnabled: readingProgressCheckbox.checked,
    });
    showSettingsStatus('Reading progress setting saved.', 'success');
  } catch (error) {
    console.error('Failed to save reading progress setting:', error);
    showSettingsStatus('Failed to save reading progress setting.', 'error');
  }
});

autoSaveCheckbox.addEventListener('change', async () => {
  try {
    await storage.updateSettings({
      autoSaveEnabled: autoSaveCheckbox.checked,
    });
    showSettingsStatus('Auto-save setting saved.', 'success');
  } catch (error) {
    console.error('Failed to save auto-save setting:', error);
  }
});

// OAuth sign-in
oauthSignInBtn.addEventListener('click', async () => {
  oauthSignInBtn.disabled = true;
  oauthSignInBtn.textContent = 'Signing in...';
  oauthError.className = 'oauth-error';

  try {
    const response = await browser.runtime.sendMessage({ type: 'OAUTH_START' });

    if (!response.success) {
      throw new Error(response.error || 'Sign-in failed');
    }

    // Success - reload credentials
    showStatus('Signed in successfully!');
    await loadCredentials();
  } catch (error) {
    console.error('OAuth sign-in failed:', error);
    oauthError.textContent = error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
    oauthError.className = 'oauth-error visible';
  } finally {
    oauthSignInBtn.disabled = false;
    oauthSignInBtn.textContent = 'Sign in with Zotero';
  }
});

// Initialize
loadCredentials();
loadSettings();
