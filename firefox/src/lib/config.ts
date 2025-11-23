/**
 * Webtero Configuration
 *
 * Feature flags and OAuth configuration.
 * Values are injected at build time from .env file.
 */

export const config = {
  /**
   * Feature Flags
   */
  features: {
    /**
     * Enable OAuth-based authentication with Zotero.
     * When false, users must manually enter their API key.
     */
    oauthEnabled: __FEATURE_OAUTH_ENABLED__,
  },

  /**
   * Zotero OAuth 1.0a Configuration
   * Only used when features.oauthEnabled is true
   */
  oauth: {
    clientKey: __ZOTERO_OAUTH_CLIENT_KEY__,
    clientSecret: __ZOTERO_OAUTH_CLIENT_SECRET__,

    // Zotero OAuth endpoints
    requestTokenUrl: 'https://www.zotero.org/oauth/request',
    authorizeUrl: 'https://www.zotero.org/oauth/authorize',
    accessTokenUrl: 'https://www.zotero.org/oauth/access',

    // Callback URL - Zotero redirects here after authorization
    // The content script detects this URL and extracts the OAuth verifier
    callbackUrl: 'https://www.zotero.org/connector_auth_complete',
  },

  /**
   * Zotero API Configuration
   */
  api: {
    baseUrl: 'https://api.zotero.org',
  },
} as const;

// Type declarations for build-time injected values
declare const __FEATURE_OAUTH_ENABLED__: boolean;
declare const __ZOTERO_OAUTH_CLIENT_KEY__: string;
declare const __ZOTERO_OAUTH_CLIENT_SECRET__: string;
