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
const apiKeyAtlosInput = document.getElementById('apiKeyAtlos') as HTMLInputElement;
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

  const authAtlos = await storage.getAuthAtlos();
  if (authAtlos) {
    apiKeyAtlosInput.value = maskKey(authAtlos.apiKeyAtlos);
    atlosSyncSection.style.display = 'block';
  } else {
    atlosSyncSection.style.display = 'none';
  }
}

function maskKey(key: string): string {
  const maskLength = key.length - 4;
  return key.substring(0, 4) + '*'.repeat(maskLength);
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

  const apiKeyAtlos = apiKeyAtlosInput.value.trim();

  if (!apiKeyAtlos) {
    showStatusAtlos('Please enter an API key. Key removed from device storage.', true);
    await storage.clearAuthAtlos();
    return;
  }

  if (apiKeyAtlos.indexOf("*") !== -1) {
    showStatusAtlos('API key appears to be masked. Please enter the full API key or clear out its value and save again.', true);
    return;
  }

  try {
    await storage.setAuthAtlos({ apiKeyAtlos });
    showStatusAtlos('Credentials saved successfully!');

    apiKeyAtlosInput.value = maskKey(apiKeyAtlos);
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
      type: 'SYNC_PROJECTS',
    });

    if (response.success) {
      const count = response.data ? Object.keys(response.data).length : 0;
      showSyncStatus(`Synced ${count} project${count === 1 ? '' : 's'} successfully!`, 'success');
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
      const count = response.data ? Object.keys(response.data).length : 0;
      showSyncStatusAtlos(`Synced ${count} Atlos project${count === 1 ? '' : 's'} successfully!`, 'success');
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
