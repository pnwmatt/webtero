/**
 * Zotero OAuth 1.0a Service
 *
 * Handles OAuth authentication flow with Zotero's API.
 * Based on the original zotero-browser-extension implementation.
 */

import { config } from './config';
import { storage } from './storage';
import { OAuthSimple } from './oauth-simple';

export interface OAuthUserInfo {
  userID: string;
  username: string;
  apiKey: string;
}

// In-memory storage for OAuth flow (cleared after completion)
let _tokenSecret: string | undefined;
let _authWindow: browser.windows.Window | null = null;
let _authDeferred: {
  resolve: (value: OAuthUserInfo) => void;
  reject: (error: Error) => void;
} | null = null;

/**
 * Parse URL-encoded form data into an object
 */
function decodeFormData(data: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = data.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      result[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }
  return result;
}

/**
 * Start the OAuth authorization flow
 * Opens a popup window for the user to authorize the application
 */
export async function authorize(): Promise<OAuthUserInfo> {
  if (!config.features.oauthEnabled) {
    throw new Error('OAuth is not enabled');
  }

  // Create a deferred promise
  const promise = new Promise<OAuthUserInfo>((resolve, reject) => {
    _authDeferred = { resolve, reject };
  });

  try {
    // Step 1: Get request token
    const oauth = new OAuthSimple(config.oauth.clientKey, config.oauth.clientSecret);
    oauth.setURL(config.oauth.requestTokenUrl);
    oauth.setAction('POST');
    oauth.signatures({
      consumer_key: config.oauth.clientKey,
      shared_secret: config.oauth.clientSecret,
    });
    oauth.setParameters({
      oauth_callback: config.oauth.callbackUrl,
    });

    const headerString = oauth.getHeaderString();

    const response = await fetch(config.oauth.requestTokenUrl, {
      method: 'POST',
      headers: {
        Authorization: headerString,
      },
    });

    if (!response.ok) {
      throw new Error(`OAuth request failed: ${response.status} ${response.statusText}`);
    }

    const responseText = await response.text();
    const data = decodeFormData(responseText);

    // Store token secret for later
    _tokenSecret = data.oauth_token_secret;

    // Step 2: Build authorization URL
    const authParams = new URLSearchParams({
      oauth_token: data.oauth_token,
      library_access: '1',
      notes_access: '0',
      write_access: '1',
      name: 'Webtero for Firefox',
    });

    const authUrl = `${config.oauth.authorizeUrl}?${authParams.toString()}`;

    // Step 3: Open authorization window
    _authWindow = await browser.windows.create({
      url: authUrl,
      type: 'popup',
      width: 900,
      height: 600,
    });

    // Listen for window close (user cancelled)
    browser.windows.onRemoved.addListener(onWindowClosed);

    return promise;
  } catch (error) {
    _authDeferred = null;
    _tokenSecret = undefined;
    throw error;
  }
}

/**
 * Handle window closed event (user cancelled authorization)
 */
function onWindowClosed(windowId: number) {
  if (_authWindow && _authWindow.id === windowId) {
    browser.windows.onRemoved.removeListener(onWindowClosed);
    _authWindow = null;

    if (_authDeferred) {
      _authDeferred.reject(new Error('Authorization cancelled by user'));
      _authDeferred = null;
    }
    _tokenSecret = undefined;
  }
}

/**
 * Handle OAuth callback from content script
 * Called when user completes authorization on Zotero website
 */
export async function onAuthorizationComplete(queryString: string): Promise<void> {
  if (!_authDeferred || !_tokenSecret) {
    console.error('OAuth callback received but no pending authorization');
    return;
  }

  // Close the auth window
  if (_authWindow?.id) {
    browser.windows.onRemoved.removeListener(onWindowClosed);
    try {
      await browser.windows.remove(_authWindow.id);
    } catch {
      // Window may already be closed
    }
    _authWindow = null;
  }

  try {
    const callbackData = decodeFormData(queryString);

    // Step 4: Exchange request token for access token
    const oauth = new OAuthSimple(config.oauth.clientKey, config.oauth.clientSecret);
    oauth.setURL(config.oauth.accessTokenUrl);
    oauth.setAction('POST');
    oauth.signatures({
      consumer_key: config.oauth.clientKey,
      shared_secret: config.oauth.clientSecret,
      oauth_token: callbackData.oauth_token,
      oauth_token_secret: _tokenSecret,
    });
    oauth.setParameters({
      oauth_verifier: callbackData.oauth_verifier,
    });

    const response = await fetch(config.oauth.accessTokenUrl, {
      method: 'POST',
      headers: {
        Authorization: oauth.getHeaderString(),
      },
    });

    if (!response.ok) {
      throw new Error(`OAuth access token request failed: ${response.status}`);
    }

    const responseText = await response.text();
    const tokenData = decodeFormData(responseText);

    // The oauth_token_secret from the access token response is the API key
    const apiKey = tokenData.oauth_token_secret;
    const userID = tokenData.userID;
    const username = tokenData.username;

    // Step 5: Verify the API key has proper permissions
    const keysUrl = `${config.api.baseUrl}/users/${userID}/keys/current`;
    const verifyResponse = await fetch(keysUrl, {
      headers: {
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3',
      },
    });

    if (!verifyResponse.ok) {
      throw new Error('Failed to verify API key permissions');
    }

    const keyInfo = await verifyResponse.json();

    // Check permissions
    const access = keyInfo.access;
    if (!access?.user?.library || !access?.user?.write) {
      throw new Error('Insufficient permissions. Please authorize with library and write access.');
    }

    // Step 6: Store credentials
    await storage.setAuth({
      apiKey,
      userID,
    });

    const result: OAuthUserInfo = {
      userID,
      username,
      apiKey,
    };

    _authDeferred.resolve(result);
    _authDeferred = null;
    _tokenSecret = undefined;
  } catch (error) {
    _authDeferred?.reject(error instanceof Error ? error : new Error(String(error)));
    _authDeferred = null;
    _tokenSecret = undefined;
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const auth = await storage.getAuth();
  return !!(auth?.apiKey && auth?.userID);
}

/**
 * Get current user info if authenticated
 */
export async function getUserInfo(): Promise<{ userID: string; username?: string } | null> {
  const auth = await storage.getAuth();
  if (!auth?.apiKey || !auth?.userID) {
    return null;
  }

  // Optionally fetch username from API
  try {
    const keysUrl = `${config.api.baseUrl}/users/${auth.userID}/keys/current`;
    const response = await fetch(keysUrl, {
      headers: {
        'Zotero-API-Key': auth.apiKey,
        'Zotero-API-Version': '3',
      },
    });

    if (response.ok) {
      const keyInfo = await response.json();
      return {
        userID: auth.userID,
        username: keyInfo.username,
      };
    }
  } catch {
    // Ignore errors, just return basic info
  }

  return { userID: auth.userID };
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<void> {
  await storage.clearAuth();
}
