import { storage } from '../lib/storage';

const form = document.getElementById('authForm') as HTMLFormElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const userIDInput = document.getElementById('userID') as HTMLInputElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

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
