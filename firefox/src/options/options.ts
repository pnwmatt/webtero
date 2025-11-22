import { storage } from '../lib/storage';
import { zoteroConnector } from '../lib/zotero-connector';

const form = document.getElementById('authForm') as HTMLFormElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const userIDInput = document.getElementById('userID') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const connectorStatusDiv = document.getElementById('connectorStatus') as HTMLDivElement;

// Load existing credentials
async function loadCredentials() {
  const auth = await storage.getAuth();
  if (auth) {
    apiKeyInput.value = auth.apiKey;
    userIDInput.value = auth.userID;
  }
}

// Show status message
function showStatus(message: string, isError: boolean = false) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${isError ? 'error' : 'success'}`;

  setTimeout(() => {
    statusDiv.className = 'status';
  }, 3000);
}

// Check connector status
async function checkConnectorStatus() {
  const isConnected = await zoteroConnector.ping();

  if (isConnected) {
    const info = await zoteroConnector.getInfo();
    connectorStatusDiv.innerHTML = `
      <p><strong>✓ Connected</strong></p>
      ${info?.version ? `<p>Version: ${info.version}</p>` : ''}
    `;
    connectorStatusDiv.className = 'connector-status connected';
  } else {
    connectorStatusDiv.innerHTML = `
      <p><strong>✗ Not Connected</strong></p>
      <p>Make sure Zotero is running on your computer.</p>
    `;
    connectorStatusDiv.className = 'connector-status disconnected';
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
      apiKeyInput.value = '';
      userIDInput.value = '';
      showStatus('Credentials cleared');
    } catch (error) {
      showStatus('Failed to clear credentials', true);
      console.error(error);
    }
  }
});

// Initialize
loadCredentials();
checkConnectorStatus();

// Check connector status every 10 seconds
setInterval(checkConnectorStatus, 10000);
