import { storage } from '../lib/storage';

const form = document.getElementById('authForm') as HTMLFormElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const userIDInput = document.getElementById('userID') as HTMLInputElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const syncProjectsBtn = document.getElementById('syncProjectsBtn') as HTMLButtonElement;
const syncStatus = document.getElementById('syncStatus') as HTMLDivElement;
const linkIndicatorsCheckbox = document.getElementById('linkIndicatorsEnabled') as HTMLInputElement;
const readingProgressCheckbox = document.getElementById('readingProgressEnabled') as HTMLInputElement;
const autoSaveCheckbox = document.getElementById('autoSaveEnabled') as HTMLInputElement;
const oauthSignInBtn = document.getElementById('oauthSignInBtn') as HTMLButtonElement;
const oauthError = document.getElementById('oauthError') as HTMLParagraphElement;

// Load existing credentials
async function loadCredentials() {
  const auth = await storage.getAuth();
  if (auth) {
    usernameInput.value = auth.username || '';
    apiKeyInput.value = auth.apiKey;
    userIDInput.value = auth.userID;
  }
}

// Load existing settings
async function loadSettings() {
  const settings = await storage.getSettings();
  linkIndicatorsCheckbox.checked = settings.linkIndicatorsEnabled;
  readingProgressCheckbox.checked = settings.readingProgressEnabled;
  autoSaveCheckbox.checked = settings.autoSaveEnabled;
}

// Show status message
function showStatus(message: string, isError: boolean = false) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${isError ? 'error' : 'success'}`;

  setTimeout(() => {
    statusDiv.className = 'status';
  }, 3000);
}

// Show sync status
function showSyncStatus(message: string, type: 'success' | 'error' | 'loading') {
  syncStatus.textContent = message;
  syncStatus.className = `sync-status visible ${type}`;

  if (type !== 'loading') {
    setTimeout(() => {
      syncStatus.className = 'sync-status';
    }, 5000);
  }
}

// Save credentials
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const apiKey = apiKeyInput.value.trim();
  const userID = userIDInput.value.trim();

  if (!apiKey) {
    showStatus('Please enter an API key', true);
    return;
  }

  try {
    await storage.setAuth({ apiKey, userID });
    showStatus('Credentials saved successfully!');
  } catch (error) {
    showStatus('Failed to save credentials', true);
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

// Sync projects
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

// Save settings when toggles change
linkIndicatorsCheckbox.addEventListener('change', async () => {
  try {
    await storage.updateSettings({
      linkIndicatorsEnabled: linkIndicatorsCheckbox.checked,
    });
  } catch (error) {
    console.error('Failed to save link indicators setting:', error);
  }
});

readingProgressCheckbox.addEventListener('change', async () => {
  try {
    await storage.updateSettings({
      readingProgressEnabled: readingProgressCheckbox.checked,
    });
  } catch (error) {
    console.error('Failed to save reading progress setting:', error);
  }
});

autoSaveCheckbox.addEventListener('change', async () => {
  try {
    await storage.updateSettings({
      autoSaveEnabled: autoSaveCheckbox.checked,
    });
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
