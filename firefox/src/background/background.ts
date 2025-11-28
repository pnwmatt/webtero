import type { Message, MessageResponse, OutboxAnnotation, HighlightColor } from '../lib/types';
import { storage } from '../lib/storage';
import { zoteroAPI } from '../lib/zotero-api';
import { generateId, normalizeUrl, md5 } from '../lib/utils';
import { config } from '../lib/config';
import * as zoteroOAuth from '../lib/zotero-oauth';

const LOG_LEVEL = 0;

// Track pages currently being saved (URL -> Promise that resolves when save completes)
// This prevents multiple saves when annotations are queued rapidly
const savesInProgress = new Map<string, Promise<void>>();

// Track pending auto-save by target URL (set when link is clicked)
// When onUpdated fires with a matching URL, we transfer to pendingAutoSaveParents by tabId
let pendingAutoSaveByUrl: Object | null = null; // { sourceItemKey: string; sourceUrl: string; expires: number };

// Track pending auto-save by tabId (set when tab loads a URL from pendingAutoSaveByUrl)
// Content script checks this on init to know if it should start auto-save countdown
const pendingAutoSaveParents = new Map<number, { sourceItemKey: string; sourceUrl: string; expires: number }>();

// Auto-save delay in milliseconds (5 seconds)
// Content script handles this delay to show UI feedback
const AUTO_SAVE_DELAY_MS = 5000;

if (LOG_LEVEL > 0) console.log('Webtero background script loaded');

/**
 * Handle messages from sidebar and content scripts
 */
browser.runtime.onMessage.addListener(
  async (
    message: Message,
    sender: browser.runtime.MessageSender
  ): Promise<MessageResponse> => {
    if (LOG_LEVEL > 0) console.log('Background received message:', message.type);

    try {
      switch (message.type) {
        case 'GET_PAGE_DATA':
          return await handleGetPageData(message.data as { url: string });

        case 'SAVE_PAGE':
          return await handleSavePage(
            message.data as { url: string; title: string; collections?: string[] }
          );

        case 'CREATE_ANNOTATION':
          return await handleCreateAnnotation(
            message.data as {
              url: string;
              text: string;
              comment?: string;
              color: string;
              position: { xpath: string; offset: number; length: number };
            }
          );

        case 'GET_ANNOTATIONS':
          return await handleGetAnnotations(message.data as { url: string });

        case 'SYNC_PROJECTS_ZOTERO':
          return await handleSyncZoteroProjects();

        case 'SYNC_PROJECTS_ATLOS':
          return await handleSyncAtlosProjects();

        case 'DELETE_ANNOTATION':
          return await handleDeleteAnnotation(message.data as { id: string });

        case 'UPDATE_ANNOTATION':
          return await handleUpdateAnnotation(
            message.data as { id: string; color?: string; comment?: string }
          );

        case 'GET_ALL_SNAPSHOT_ANNOTATIONS':
          return await handleGetAllSnapshotAnnotations(
            message.data as { itemKey: string }
          );

        case 'INJECT_SINGLEFILE':
          return await handleInjectSingleFile(sender);

        // OAuth handlers
        case 'OAUTH_START':
          return await handleOAuthStart();

        case 'OAUTH_CALLBACK':
          return await handleOAuthCallback(message.data as { queryString: string });

        case 'OAUTH_CHECK_AUTH':
          return await handleOAuthCheckAuth();

        case 'OAUTH_SIGN_OUT':
          return await handleOAuthSignOut();

        case 'OAUTH_GET_USER_INFO':
          return await handleOAuthGetUserInfo();

        // Page focus and link tracking handlers
        case 'START_FOCUS_SESSION':
          return await handleStartFocusSession(
            message.data as { itemKey: string; tabId: number },
            sender
          );

        case 'UPDATE_FOCUS_SESSION':
          return await handleUpdateFocusSession(
            message.data as { sessionId: string; readRange: { start: number; end: number } }
          );

        case 'END_FOCUS_SESSION':
          return await handleEndFocusSession(
            message.data as { sessionId: string }
          );

        case 'GET_PAGE_READ_PERCENTAGE':
          return await handleGetPageReadPercentage(
            message.data as { itemKey: string }
          );

        case 'SET_READ_PERCENTAGE':
          return await handleSetReadPercentage(
            message.data as { itemKey: string; percentage: number }
          );

        case 'ENABLE_AUTO_SAVE':
          return await handleEnableAutoSave(
            message.data as { tabId: number; sourceItemKey: string; sourceUrl: string }
          );

        case 'DISABLE_AUTO_SAVE':
          return await handleDisableAutoSave(
            message.data as { tabId: number }
          );

        case 'CHECK_AUTO_SAVE':
          return await handleCheckAutoSave(
            message.data as { tabId: number },
            sender
          );

        case 'LINK_CLICKED':
          return await handleLinkClicked(
            message.data as { tabId: number; targetUrl: string },
            sender
          );

        case 'GET_PAGE_LINKS':
          return await handleGetPageLinks(
            message.data as { itemKey: string }
          );

        case 'GET_SAVED_URLS':
          return await handleGetSavedUrls();

        // Annotation outbox handlers
        case 'QUEUE_ANNOTATION':
          return await handleQueueAnnotation(
            message.data as {
              url: string;
              title: string;
              text: string;
              comment?: string;
              color: string;
              position: { xpath: string; offset: number; length: number };
              collections?: string[];
            }
          );

        case 'GET_OUTBOX_ANNOTATIONS':
          return await handleGetOutboxAnnotations(
            message.data as { url: string }
          );

        case 'RETRY_OUTBOX_ANNOTATION':
          return await handleRetryOutboxAnnotation(
            message.data as { id: string; title: string; collections?: string[] }
          );

        case 'DELETE_OUTBOX_ANNOTATION':
          return await handleDeleteOutboxAnnotation(
            message.data as { id: string }
          );

        case 'CHECK_SAVE_IN_PROGRESS':
          return handleCheckSaveInProgress(
            message.data as { url: string }
          );

        case 'CHECK_PENDING_AUTO_SAVE':
          return await handleCheckPendingAutoSave(
            message.data as { url: string; tabId: number },
            sender
          );

        case 'EXECUTE_AUTO_SAVE':
          return await handleExecuteAutoSave(
            message.data as { url: string; title: string; tabId: number; html?: string },
            sender
          );

        case 'CANCEL_PENDING_AUTO_SAVE':
          return handleCancelPendingAutoSave(
            message.data as { tabId: number }
          );

        default:
          return { success: false, error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
);

/**
 * Get data for the current page
 */
async function handleGetPageData(data: {
  url: string;
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);
  const page = await storage.getPage(normalizedUrl);
  const annotations = await storage.getAnnotationsByPage(normalizedUrl);

  // Fetch snapshots if page exists in Zotero
  let snapshots: Array<{
    key: string;
    title: string;
    dateAdded: string;
    url: string;
  }> = [];

  if (page?.zoteroItemKey) {
    try {
      const zoteroSnapshots = await zoteroAPI.getSnapshots(page.zoteroItemKey);
      snapshots = zoteroSnapshots.map((s) => ({
        key: s.key,
        title: s.data.title || 'Snapshot',
        dateAdded: s.data.dateAdded ? String(s.data.dateAdded) : '',
        url: s.data.url || normalizedUrl,
      }));
    } catch (error) {
      console.error('Failed to fetch snapshots:', error);
    }
  }

  return {
    success: true,
    data: {
      page,
      annotations,
      snapshots,
    },
  };
}

/**
 * Save a page to Zotero with snapshot
 */
async function handleSavePage(data: {
  url: string;
  title: string;
  collections?: string[];
  tabId?: number; // Optional: specific tab to capture from (for auto-save)
  html?: string; // Optional: pre-captured HTML (for auto-save from content script)
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);
  const collections = data.collections;

  // Check if an item already exists for this URL
  let item: Awaited<ReturnType<typeof zoteroAPI.findItemByUrl>> = null;
  let isExistingItem = false;

  // First check local storage for existing item key
  const existingPage = await storage.getPage(normalizedUrl);
  if (existingPage?.zoteroItemKey) {
    try {
      item = await zoteroAPI.getItem(existingPage.zoteroItemKey);
      isExistingItem = true;
      if (LOG_LEVEL > 0) console.log('Found existing item from local storage:', item.key);
    } catch (error) {
      console.error('Failed to fetch existing item from storage:', error);
      // Item may have been deleted from Zotero, fall through to search/create
    }
  }

  // Fall back to API search if not found locally
  if (!item) {
    item = await zoteroAPI.findItemByUrl(normalizedUrl);
    if (item) {
      if (LOG_LEVEL > 0) console.log('Found existing item from API search:', item.key);
      isExistingItem = true;
    }
  }

  // Create new item if none found
  if (!item) {
    item = await zoteroAPI.createWebpageItem(
      normalizedUrl,
      data.title,
      collections
    );
    if (LOG_LEVEL > 0) console.log('Created new item:', item.key);
  }

  // Extract confirmed collections from API response
  const confirmedCollections = item.data.collections ?? [];

  let snapshotSaved = false;

  // Try to capture and upload snapshot
  try {
    let htmlContent: string | null = null;

    // Use pre-captured HTML if provided (from auto-save)
    if (data.html) {
      htmlContent = data.html;
    } else {
      // Get tab to capture HTML from
      let captureTabId: number | undefined;
      if (data.tabId) {
        captureTabId = data.tabId;
      } else {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        captureTabId = tabs[0]?.id;
      }

      if (captureTabId) {
        // Request HTML capture from content script
        const captureResponse = await browser.tabs.sendMessage(captureTabId, {
          type: 'CAPTURE_PAGE_HTML',
        });

        if (captureResponse?.success && captureResponse.data) {
          htmlContent = captureResponse.data as string;
        }
      }
    }

    if (htmlContent) {

        // Convert HTML string to Uint8Array
        const encoder = new TextEncoder();
        const htmlData = encoder.encode(htmlContent);

        // Calculate MD5 hash
        const hash = md5(htmlData);

        // Generate filename (matching Zotero's naming convention)
        // Sanitize title: replace invalid chars, limit length
        const sanitizedTitle = data.title
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace invalid filename chars
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim()
          .slice(0, 100); // Limit length
        const filename = `${sanitizedTitle}.html`;

        // Get existing snapshots to determine the next snapshot number
        const existingSnapshots = await zoteroAPI.getSnapshots(item.key);
        const snapshotNumber = existingSnapshots.length + 1;
        const attachmentTitle = `Snapshot ${snapshotNumber}`;

        // Create attachment item
        // This adds to the existing item or the newly created one
        const attachment = await zoteroAPI.createAttachmentItem(
          item.key,
          normalizedUrl,
          attachmentTitle
        );

        // Upload the HTML content
        await zoteroAPI.uploadAttachment(
          attachment.key,
          htmlData,
          filename,
          hash
        );

        snapshotSaved = true;
        if (LOG_LEVEL > 0) console.log('Snapshot saved successfully:', filename, isExistingItem ? '(added to existing item)' : '(new item)');
    }
  } catch (error) {
    // Log error but don't fail the save operation
    console.error('Failed to save snapshot:', error);
  }

  await storage.savePage({
    url: normalizedUrl,
    zoteroItemKey: item.key,
    title: data.title,
    projects: confirmedCollections,
    dateAdded: new Date().toISOString(),
    snapshot: snapshotSaved,
    version: item.version,
  });

  return {
    success: true,
    data: { itemKey: item.key, projects: confirmedCollections, snapshot: snapshotSaved },
  };
}

/**
 * Create an annotation
 */
async function handleCreateAnnotation(data: {
  url: string;
  text: string;
  comment?: string;
  color: string;
  position: { xpath: string; offset: number; length: number; cssSelector?: string; selectorStart?: number; selectorEnd?: number };
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);

  // Get the page to find the Zotero item key
  const page = await storage.getPage(normalizedUrl);
  if (!page) {
    return { success: false, error: 'Page not saved to Zotero yet' };
  }

  // Get the most recent snapshot to associate the annotation with locally
  let snapshotKey: string | undefined;
  try {
    const snapshots = await zoteroAPI.getSnapshots(page.zoteroItemKey);
    if (snapshots.length > 0) {
      // Use the most recent snapshot
      snapshotKey = snapshots[0].key;
    }
  } catch (error) {
    console.error('Failed to fetch snapshots for annotation:', error);
  }

  if (!snapshotKey) {
    return { success: false, error: 'No snapshot found. Please save a snapshot first.' };
  }

  // Create annotation in Zotero as a child of the snapshot attachment
  const zoteroAnnotation = await zoteroAPI.createAnnotation(
    snapshotKey,
    data.text,
    data.comment,
    data.color,
    data.position
  );

  // Save annotation locally with snapshot association for tracking
  const annotation = {
    id: generateId(),
    pageUrl: normalizedUrl,
    zoteroItemKey: page.zoteroItemKey,
    zoteroNoteKey: zoteroAnnotation.key,
    snapshotKey,
    text: data.text,
    comment: data.comment,
    color: data.color as any,
    position: data.position,
    created: new Date().toISOString(),
  };

  await storage.saveAnnotation(annotation);

  // Notify sidebar of the new annotation
  browser.runtime.sendMessage({ type: 'ANNOTATION_CREATED', data: annotation }).catch(() => {
    // Sidebar may not be open, ignore errors
  });

  return {
    success: true,
    data: annotation,
  };
}

/**
 * Get annotations for a page
 */
async function handleGetAnnotations(data: {
  url: string;
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);
  const annotations = await storage.getAnnotationsByPage(normalizedUrl);
  if (LOG_LEVEL > 0) console.log('[webtero bg] Fetched annotations for', normalizedUrl, annotations.length);
  return {
    success: true,
    data: annotations,
  };
}

/**
 * Sync projects from Zotero
 * [
    {
        "key": "SI5SI425",
        "version": 342,
        "library": {
            "type": "user",
            "id": 13[...],
            "name": "mm",
            "links": {
                "alternate": {
                    "href": "https://www.zotero.org/mm",
                    "type": "text/html"
                }
            }
        },
        "links": {
            "self": {
                "href": "https://api.zotero.org/users/13[...]/collections/SI5SI425",
                "type": "application/json"
            },
            "alternate": {
                "href": "https://www.zotero.org/mm/collections/SI5SI425",
                "type": "text/html"
            },
            "up": {
                "href": "https://api.zotero.org/users/13[...]/collections/K2NBIMZA",
                "type": "application/json"
            }
        },
        "meta": {
            "numCollections": 0,
            "numItems": 0
        },
        "data": {
            "key": "SI5SI425",
            "version": 342,
            "name": "Competition",
            "parentCollection": "K2NBIMZA",
            "relations": {}
        }
    }
]
 */
async function handleSyncZoteroProjects(): Promise<MessageResponse> {
  const collections = await zoteroAPI.getCollections();

  // Convert to our project format
  const projects: Record<string, any> = {};
  for (const collection of collections) {
    projects[collection.key] = {
      id: collection.key,
      name: collection.data.name,
      parentId: collection.data.parentCollection || undefined,
      itemCount: collection.meta?.numItems ?? 0,
      version: collection.version,
    };
  }

  // Save to storage
  await storage.saveProjects(projects);
  await storage.setLastSync(new Date().toISOString());

  return {
    success: true,
    data: projects,
  };
}

async function handleSyncAtlosProjects(): Promise<MessageResponse> {
  const collections = await zoteroAPI.getCollections();

  // Convert to our project format
  const projects: Record<string, any> = {};
  for (const collection of collections) {
    projects[collection.key] = {
      id: collection.key,
      name: collection.data.name,
      parentId: collection.data.parentCollection || undefined,
      itemCount: collection.meta?.numItems ?? 0,
      version: collection.version,
    };
  }

  // Save to storage
  await storage.saveProjects(projects);
  await storage.setLastSync(new Date().toISOString());

  return {
    success: true,
    data: projects,
  };
}

/**
 * Update an annotation
 */
async function handleUpdateAnnotation(data: {
  id: string;
  color?: string;
  comment?: string;
}): Promise<MessageResponse> {
  const annotation = await storage.getAnnotation(data.id);
  if (!annotation) {
    return { success: false, error: 'Annotation not found' };
  }

  // Update fields
  if (data.color !== undefined) {
    annotation.color = data.color as any;
  }
  if (data.comment !== undefined) {
    annotation.comment = data.comment || undefined;
  }

  // Save updated annotation
  await storage.saveAnnotation(annotation);

  // Notify sidebar of the update
  browser.runtime.sendMessage({ type: 'ANNOTATION_UPDATED', data: annotation }).catch(() => {
    // Sidebar may not be open, ignore errors
  });

  return { success: true, data: annotation };
}

/**
 * Delete an annotation
 */
async function handleDeleteAnnotation(data: {
  id: string;
}): Promise<MessageResponse> {
  const annotation = await storage.getAnnotation(data.id);
  if (!annotation) {
    return { success: false, error: 'Annotation not found' };
  }

  // Delete from Zotero if it has a note key
  if (annotation.zoteroNoteKey) {
    const page = await storage.getPage(annotation.pageUrl);
    if (page) {
      // We'd need the version to delete, so for now we'll just remove locally
      // await zoteroAPI.deleteItem(annotation.zoteroNoteKey, version);
    }
  }

  // Delete locally
  await storage.deleteAnnotation(data.id);

  // Notify sidebar of the deletion
  browser.runtime.sendMessage({ type: 'ANNOTATION_DELETED', data: { id: data.id } }).catch(() => {
    // Sidebar may not be open, ignore errors
  });

  return { success: true };
}

/**
 * Inject SingleFile scripts into the content script context
 */
async function handleInjectSingleFile(
  sender: browser.runtime.MessageSender
): Promise<MessageResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return { success: false, error: 'No tab ID' };
  }

  try {
    const scripts = [
      'lib/singlefile/single-file-bootstrap.js',
      'lib/singlefile/single-file.js',
    ];

    for (const file of scripts) {
      await browser.scripting.executeScript({
        target: { tabId },
        files: [file],
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to inject SingleFile:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to inject SingleFile',
    };
  }
}

/**
 * Get all annotations from all snapshots of an item
 */
async function handleGetAllSnapshotAnnotations(data: {
  itemKey: string;
}): Promise<MessageResponse> {
  try {
    // Get all snapshots for this item
    const snapshots = await zoteroAPI.getSnapshots(data.itemKey);

    // Get annotations for each snapshot
    const allAnnotations: Array<{
      id: string;
      pageUrl: string;
      zoteroItemKey: string;
      zoteroNoteKey?: string;
      snapshotKey: string;
      text: string;
      comment?: string;
      color: string;
      position: { xpath: string; offset: number; length: number };
      created: string;
    }> = [];

    for (const snapshot of snapshots) {
      // Get annotations stored for this snapshot
      const snapshotAnnotations = await storage.getAnnotationsBySnapshot(snapshot.key);
      for (const ann of snapshotAnnotations) {
        allAnnotations.push({
          ...ann,
          snapshotKey: snapshot.key,
        });
      }
    }

    return {
      success: true,
      data: allAnnotations,
    };
  } catch (error) {
    console.error('Failed to get all snapshot annotations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// OAuth Handlers
// ============================================

/**
 * Start OAuth authorization flow
 */
async function handleOAuthStart(): Promise<MessageResponse> {
  if (!config.features.oauthEnabled) {
    return { success: false, error: 'OAuth is not enabled' };
  }

  try {
    const userInfo = await zoteroOAuth.authorize();
    return { success: true, data: userInfo };
  } catch (error) {
    console.error('OAuth authorization failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authorization failed',
    };
  }
}

/**
 * Handle OAuth callback from content script
 */
async function handleOAuthCallback(data: {
  queryString: string;
}): Promise<MessageResponse> {
  try {
    await zoteroOAuth.onAuthorizationComplete(data.queryString);
    return { success: true };
  } catch (error) {
    console.error('OAuth callback failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Callback processing failed',
    };
  }
}

/**
 * Check if user is authenticated
 */
async function handleOAuthCheckAuth(): Promise<MessageResponse> {
  const isAuthenticated = await zoteroOAuth.isAuthenticated();
  return {
    success: true,
    data: {
      isAuthenticated,
      oauthEnabled: config.features.oauthEnabled,
    },
  };
}

/**
 * Sign out the current user
 */
async function handleOAuthSignOut(): Promise<MessageResponse> {
  try {
    await zoteroOAuth.signOut();
    return { success: true };
  } catch (error) {
    console.error('Sign out failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Sign out failed',
    };
  }
}

/**
 * Get current user info
 */
async function handleOAuthGetUserInfo(): Promise<MessageResponse> {
  try {
    const userInfo = await zoteroOAuth.getUserInfo();
    return { success: true, data: userInfo };
  } catch (error) {
    console.error('Failed to get user info:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get user info',
    };
  }
}

// ============================================
// Page Focus and Link Tracking Handlers
// ============================================

/**
 * Start a new focus session for a saved page
 */
async function handleStartFocusSession(
  data: { itemKey: string; tabId: number },
  sender: browser.runtime.MessageSender
): Promise<MessageResponse> {
  // Get tab ID from sender if not provided
  const tabId = data.tabId !== -1 ? data.tabId : (sender.tab?.id ?? -1);

  if (LOG_LEVEL > 0) console.log('Webtero: Starting focus session for', data.itemKey, 'in tab', tabId);

  const session = {
    id: generateId(),
    itemKey: data.itemKey,
    tabId: tabId,
    startTime: new Date().toISOString(),
    readRanges: [],
  };

  await storage.saveFocusSession(session);

  return { success: true, data: { sessionId: session.id } };
}

/**
 * Update a focus session with new scroll position data
 */
async function handleUpdateFocusSession(data: {
  sessionId: string;
  readRange: { start: number; end: number };
}): Promise<MessageResponse> {
  const session = await storage.getFocusSession(data.sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  // Add the new range (will be merged when calculating percentage)
  session.readRanges.push(data.readRange);
  await storage.saveFocusSession(session);

  return { success: true };
}

/**
 * End a focus session
 */
async function handleEndFocusSession(data: {
  sessionId: string;
}): Promise<MessageResponse> {
  const session = await storage.getFocusSession(data.sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  session.endTime = new Date().toISOString();
  await storage.saveFocusSession(session);

  return { success: true };
}

/**
 * Get read percentage for a saved page
 */
async function handleGetPageReadPercentage(data: {
  itemKey: string;
}): Promise<MessageResponse> {
  const percentage = await storage.getReadPercentage(data.itemKey);
  return { success: true, data: { percentage } };
}

/**
 * Set read percentage to a specific value (e.g., mark as 100% read)
 */
async function handleSetReadPercentage(data: {
  itemKey: string;
  percentage: number;
}): Promise<MessageResponse> {
  // Create a focus session that covers the entire document
  const sessionId = `manual-${Date.now()}`;
  await storage.saveFocusSession({
    id: sessionId,
    itemKey: data.itemKey,
    tabId: -1,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    readRanges: [{ start: 0, end: data.percentage }],
  });

  return { success: true };
}

/**
 * Enable auto-save for a tab (after saving a page)
 */
async function handleEnableAutoSave(data: {
  tabId: number;
  sourceItemKey: string;
  sourceUrl: string;
}): Promise<MessageResponse> {
  await storage.saveAutoSaveTab({
    tabId: data.tabId,
    sourceItemKey: data.sourceItemKey,
    sourceUrl: data.sourceUrl,
    enabled: true,
  });

  return { success: true };
}

/**
 * Disable auto-save for a tab
 */
async function handleDisableAutoSave(data: {
  tabId: number;
}): Promise<MessageResponse> {
  await storage.deleteAutoSaveTab(data.tabId);
  return { success: true };
}

/**
 * Check if auto-save is enabled for a tab
 */
async function handleCheckAutoSave(
  data: { tabId: number },
  sender: browser.runtime.MessageSender
): Promise<MessageResponse> {
  // Get tab ID from sender (content script sends -1)
  const tabId = sender.tab?.id ?? data.tabId;
  if (tabId === undefined || tabId < 0) {
    return { success: false, error: 'Could not determine tab ID' };
  }

  const tab = await storage.getAutoSaveTab(tabId);
  return {
    success: true,
    data: {
      enabled: tab?.enabled ?? false,
      sourceItemKey: tab?.sourceItemKey,
      sourceUrl: tab?.sourceUrl,
    },
  };
}

/**
 * Check if a save is in progress for a given URL
 */
function handleCheckSaveInProgress(data: { url: string }): MessageResponse {
  const normalizedUrl = normalizeUrl(data.url);
  const isInProgress = savesInProgress.has(normalizedUrl);
  return {
    success: true,
    data: { inProgress: isInProgress },
  };
}

/**
 * Check if there's a pending auto-save for the given URL/tab.
 * Called by sidebar or content script when page loads.
 */
async function handleCheckPendingAutoSave(
  data: { url: string; tabId: number },
  sender: browser.runtime.MessageSender
): Promise<MessageResponse> {
  // Get tab ID from sender if not provided (content script sends -1)
  const tabId = data.tabId >= 0 ? data.tabId : sender.tab?.id;
  if (tabId === undefined) {
    return { success: false, error: 'Could not determine tab ID' };
  }

  // Check if this tab has a pending auto-save
  const pending = pendingAutoSaveParents.get(tabId);
  if (pending && Date.now() < pending.expires) {
    if (LOG_LEVEL > 0) console.log(`Webtero: Found pending auto-save for tab ${data.tabId}`);
    return {
      success: true,
      data: {
        shouldAutoSave: true,
        sourceItemKey: pending.sourceItemKey,
        sourceUrl: pending.sourceUrl,
        delayMs: AUTO_SAVE_DELAY_MS,
      },
    };
  }

  return {
    success: true,
    data: { shouldAutoSave: false },
  };
}

/**
 * Cancel a pending auto-save for a tab.
 * Called by sidebar when user clicks cancel.
 */
function handleCancelPendingAutoSave(
  data: { tabId: number }
): MessageResponse {
  pendingAutoSaveParents.delete(data.tabId);
  if (LOG_LEVEL > 0) console.log(`Webtero: Cancelled pending auto-save for tab ${data.tabId}`);
  return { success: true };
}

/**
 * Execute auto-save from content script or sidebar after the countdown completes.
 * Creates the page snapshot and link record.
 */
async function handleExecuteAutoSave(
  data: { url: string; title: string; tabId: number; html?: string },
  sender: browser.runtime.MessageSender
): Promise<MessageResponse> {
  // Get tab ID from sender if not provided (content script sends -1)
  const tabId = data.tabId >= 0 ? data.tabId : sender.tab?.id;
  if (tabId === undefined) {
    return { success: false, error: 'Could not determine tab ID' };
  }

  const normalizedUrl = normalizeUrl(data.url);

  // Clean up the pending entry
  pendingAutoSaveParents.delete(tabId);

  // Check if page is already saved (might have been saved manually during countdown)
  const existingPage = await storage.getPage(normalizedUrl);
  if (existingPage) {
    if (LOG_LEVEL > 0) console.log(`Webtero: Page already saved, creating link record only`);

    // Get the source item key from the auto-save tab info
    const autoSaveTab = await storage.getAutoSaveTab(tabId);
    if (autoSaveTab) {
      const link = {
        id: generateId(),
        sourceItemKey: autoSaveTab.sourceItemKey,
        targetItemKey: existingPage.zoteroItemKey,
        targetUrl: normalizedUrl,
        created: new Date().toISOString(),
      };
      await storage.savePageLink(link);
    }

    return { success: true, data: { alreadySaved: true, itemKey: existingPage.zoteroItemKey } };
  }

  // Get the auto-save tab info for link creation
  const autoSaveTab = await storage.getAutoSaveTab(tabId);
  if (!autoSaveTab) {
    return { success: false, error: 'Auto-save tab info not found' };
  }

  if (LOG_LEVEL > 0) console.log(`Webtero: Executing auto-save for ${normalizedUrl}`);

  // Track the save to prevent duplicates
  let saveResult: MessageResponse;
  const savePromise = (async () => {
    saveResult = await handleSavePage({
      url: normalizedUrl,
      title: data.title,
      collections: [],
      tabId: tabId,
      html: data.html, // Pass pre-captured HTML from content script
    });
    if (!saveResult.success) {
      throw new Error(saveResult.error || 'Failed to save page');
    }
  })();

  savesInProgress.set(normalizedUrl, savePromise);

  try {
    await savePromise;
    const savedPage = await storage.getPage(normalizedUrl);

    if (savedPage) {
      // Create link record
      const link = {
        id: generateId(),
        sourceItemKey: autoSaveTab.sourceItemKey,
        targetItemKey: savedPage.zoteroItemKey,
        targetUrl: normalizedUrl,
        created: new Date().toISOString(),
      };
      await storage.savePageLink(link);

      if (LOG_LEVEL > 0) console.log(`Webtero: Auto-save completed for ${normalizedUrl}, link created`);
    }

    return { success: true, data: saveResult!.data };
  } catch (error) {
    console.error('Webtero: Auto-save failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Auto-save failed',
    };
  } finally {
    savesInProgress.delete(normalizedUrl);
  }
}

/**
 * Handle a link click from a saved page.
 * Creates link records for saved-to-saved navigation.
 * Queues auto-save for unsaved targets if auto-save is enabled.
 */
async function handleLinkClicked(
  data: { tabId: number; targetUrl: string; sourceItemKey?: string },
  sender: browser.runtime.MessageSender
): Promise<MessageResponse> {
  const LOG_LEVEL = 0;
  if (LOG_LEVEL > 0) console.log("[webtero bg] handleLinkClicked");

  // Get tab ID from sender (content script sends -1)
  const tabId = sender.tab?.id ?? data.tabId;
  if (tabId === undefined || tabId < 0) {
    if (LOG_LEVEL > 0) console.log(`[webtero bg] handleLinkClicked: Could not determine tab ID`);
    return { success: false, error: 'Could not determine tab ID' };
  }

  // Get source item key - prefer from message data, fallback to autoSaveTab
  let sourceItemKey = data.sourceItemKey;
  const autoSaveTab = await storage.getAutoSaveTab(tabId);
  if (!sourceItemKey && autoSaveTab?.enabled) {
    sourceItemKey = autoSaveTab.sourceItemKey;
  }

  if (!sourceItemKey) {
    if (LOG_LEVEL > 0) console.log(`[webtero bg] handleLinkClicked: No source item key available`);
    return { success: false, error: 'No source item key available' };
  }

  const targetUrl = normalizeUrl(data.targetUrl);

  // Check if target page is already saved - if so, just create link record
  const existingPage = await storage.getPage(targetUrl);
  if (existingPage) {
    if (LOG_LEVEL > 0) console.log(`[webtero bg] handleLinkClicked: Target page already saved, creating link record`);
    // Create a link record for already-saved page
    const link = {
      id: generateId(),
      sourceItemKey: sourceItemKey,
      targetItemKey: existingPage.zoteroItemKey,
      targetUrl: targetUrl,
      created: new Date().toISOString(),
    };
    await storage.savePageLink(link);
    return { success: true, data: { link, targetPage: existingPage } };
  }

  // Target page is not saved - only queue auto-save if auto-save is enabled
  const settings = await storage.getSettings();
  if (!settings.autoSaveEnabled || !autoSaveTab?.enabled) {
    if (LOG_LEVEL > 0) console.log(`[webtero bg] handleLinkClicked: Target not saved and auto-save not enabled`);
    return { success: true, data: { linkNotCreated: true, reason: 'target not saved' } };
  }

  // Store pending auto-save info temporarily by target URL
  // When the tab's onUpdated fires with this URL, we'll transfer to pendingAutoSaveParents by tabId
  // This handles both same-tab navigation and new tab opening
  pendingAutoSaveByUrl = {
    sourceItemKey: autoSaveTab.sourceItemKey,
    sourceUrl: autoSaveTab.sourceUrl,
    expires: Date.now() + 5000, // 5 seconds to account for slow loads
  };

  if (LOG_LEVEL > 0) console.log(`Webtero: Recorded pending auto-save for ${targetUrl}`);

  return { success: true, data: { pending: true, targetUrl } };
}

/**
 * Get all links from/to a page
 */
async function handleGetPageLinks(data: {
  itemKey: string;
}): Promise<MessageResponse> {
  const outgoingLinks = await storage.getPageLinksBySource(data.itemKey);
  const incomingLinks = await storage.getPageLinksByTarget(data.itemKey);

  // Get read percentages for linked pages
  const linkedPages: Array<{
    itemKey: string;
    url: string;
    direction: 'outgoing' | 'incoming';
    readPercentage: number;
  }> = [];

  for (const link of outgoingLinks) {
    const percentage = await storage.getReadPercentage(link.targetItemKey);
    linkedPages.push({
      itemKey: link.targetItemKey,
      url: link.targetUrl,
      direction: 'outgoing',
      readPercentage: percentage,
    });
  }

  for (const link of incomingLinks) {
    const percentage = await storage.getReadPercentage(link.sourceItemKey);
    // Get source URL from saved page
    const pages = await storage.getAllPages();
    const sourcePage = Object.values(pages).find(
      (p) => p.zoteroItemKey === link.sourceItemKey
    );
    if (sourcePage) {
      linkedPages.push({
        itemKey: link.sourceItemKey,
        url: sourcePage.url,
        direction: 'incoming',
        readPercentage: percentage,
      });
    }
  }

  return { success: true, data: linkedPages };
}

/**
 * Get all saved URLs with their item keys, read percentages, and annotation colors
 * Used by content script to mark links on the page
 */
async function handleGetSavedUrls(): Promise<MessageResponse> {
  const pages = await storage.getAllPages();
  const allAnnotations = await storage.getAllAnnotations();
  const settings = await storage.getSettings();
  const savedUrls: Array<{
    url: string;
    itemKey: string;
    readPercentage: number;
    annotationColors: string[];
  }> = [];

  for (const page of Object.values(pages)) {
    const percentage = settings.readingProgressEnabled
      ? await storage.getReadPercentage(page.zoteroItemKey)
      : 0;

    // Get annotation colors for this page
    const pageAnnotations = Object.values(allAnnotations).filter(
      (ann) => ann.pageUrl === page.url
    );
    const annotationColors = pageAnnotations.map((ann) => ann.color);

    savedUrls.push({
      url: page.url,
      itemKey: page.zoteroItemKey,
      readPercentage: percentage,
      annotationColors,
    });
  }

  return {
    success: true,
    data: savedUrls,
    settings: { readingProgressEnabled: settings.readingProgressEnabled },
  };
}

// Clean up auto-save tabs when tabs are closed
browser.tabs.onRemoved.addListener(async (tabId) => {
  await storage.deleteAutoSaveTab(tabId);
});

// ============================================
// Annotation Outbox Handlers
// ============================================

/**
 * Queue an annotation for a page that may not be saved yet
 * Logic:
 * 1. If page already saved -> attach annotation to latest snapshot
 * 2. If save in progress -> queue annotation and wait for save to complete
 * 3. If no snapshot -> start save, queue annotation, attach when complete
 */
async function handleQueueAnnotation(data: {
  url: string;
  title: string;
  text: string;
  comment?: string;
  color: string;
  position: { xpath: string; offset: number; length: number; cssSelector?: string; selectorStart?: number; selectorEnd?: number };
  collections?: string[];
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);

  // Case 3: Page already saved - create annotation directly on latest snapshot
  const existingPage = await storage.getPage(normalizedUrl);
  if (existingPage) {
    return await handleCreateAnnotation({
      url: data.url,
      text: data.text,
      comment: data.comment,
      color: data.color,
      position: data.position,
    });
  }

  // Queue the annotation first (for both cases 1 and 2)
  const outboxAnnotation: OutboxAnnotation = {
    id: generateId(),
    pageUrl: normalizedUrl,
    text: data.text,
    comment: data.comment,
    color: data.color as HighlightColor,
    position: data.position,
    created: new Date().toISOString(),
    status: 'saving_page',
  };

  await storage.saveOutboxAnnotation(outboxAnnotation);

  // Notify sidebar of the queued annotation
  browser.runtime.sendMessage({
    type: 'OUTBOX_ANNOTATION_ADDED',
    data: outboxAnnotation,
  }).catch(() => {
    // Sidebar may not be open
  });

  // Case 1: Save already in progress - just wait for it, don't start another
  const existingSavePromise = savesInProgress.get(normalizedUrl);
  if (existingSavePromise) {
    // Wait for the existing save to complete, then create the annotation
    existingSavePromise.then(() => {
      processQueuedAnnotation(outboxAnnotation.id);
    });
    return {
      success: true,
      data: { queued: true, annotation: outboxAnnotation },
    };
  }

  // Case 2: No save in progress - start one and track it
  const savePromise = startPageSaveAndProcessAnnotations(normalizedUrl, data.title, data.collections);
  savesInProgress.set(normalizedUrl, savePromise);

  // Clean up the tracking when done
  savePromise.finally(() => {
    savesInProgress.delete(normalizedUrl);
  });

  return {
    success: true,
    data: { queued: true, annotation: outboxAnnotation },
  };
}

/**
 * Start saving a page and then process all queued annotations for that URL
 * This is the main entry point when no save is in progress
 */
async function startPageSaveAndProcessAnnotations(
  normalizedUrl: string,
  pageTitle: string,
  collections?: string[]
): Promise<void> {
  try {
    // Save the page first
    const saveResult = await handleSavePage({
      url: normalizedUrl,
      title: pageTitle,
      collections,
    });

    if (!saveResult.success) {
      // Mark all queued annotations for this URL as failed
      await markAllOutboxAnnotationsFailed(normalizedUrl, saveResult.error || 'Failed to save page');
      return;
    }

    // Page saved - process all queued annotations for this URL
    await processAllQueuedAnnotationsForUrl(normalizedUrl);

  } catch (error) {
    console.error('Failed to save page for queued annotations:', error);
    await markAllOutboxAnnotationsFailed(
      normalizedUrl,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Process a single queued annotation after the page is already saved
 */
async function processQueuedAnnotation(annotationId: string): Promise<void> {
  const outboxAnnotation = await storage.getOutboxAnnotation(annotationId);
  if (!outboxAnnotation) return;

  try {
    await storage.updateOutboxAnnotationStatus(annotationId, 'saving_annotation');
    notifyOutboxUpdate(annotationId);

    const annotationResult = await handleCreateAnnotation({
      url: outboxAnnotation.pageUrl,
      text: outboxAnnotation.text,
      comment: outboxAnnotation.comment,
      color: outboxAnnotation.color,
      position: outboxAnnotation.position,
    });

    if (!annotationResult.success) {
      await storage.updateOutboxAnnotationStatus(
        annotationId,
        'failed',
        annotationResult.error || 'Failed to create annotation'
      );
      notifyOutboxUpdate(annotationId);
      return;
    }

    // Success - remove from outbox
    await storage.deleteOutboxAnnotation(annotationId);

    // Notify sidebar that outbox item was processed
    browser.runtime.sendMessage({
      type: 'OUTBOX_ANNOTATION_COMPLETED',
      data: { id: annotationId, annotation: annotationResult.data },
    }).catch(() => { });

  } catch (error) {
    console.error('Failed to process queued annotation:', error);
    await storage.updateOutboxAnnotationStatus(
      annotationId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
    notifyOutboxUpdate(annotationId);
  }
}

/**
 * Process all queued annotations for a URL after the page has been saved
 */
async function processAllQueuedAnnotationsForUrl(normalizedUrl: string): Promise<void> {
  const allOutbox = await storage.getAllOutboxAnnotations();
  const forThisUrl = Object.values(allOutbox).filter(
    (a) => a.pageUrl === normalizedUrl && a.status === 'saving_page'
  );

  for (const annotation of forThisUrl) {
    await processQueuedAnnotation(annotation.id);
  }
}

/**
 * Mark all queued annotations for a URL as failed
 */
async function markAllOutboxAnnotationsFailed(normalizedUrl: string, error: string): Promise<void> {
  const allOutbox = await storage.getAllOutboxAnnotations();
  const forThisUrl = Object.values(allOutbox).filter(
    (a) => a.pageUrl === normalizedUrl && a.status === 'saving_page'
  );

  for (const annotation of forThisUrl) {
    await storage.updateOutboxAnnotationStatus(annotation.id, 'failed', error);
    notifyOutboxUpdate(annotation.id);
  }
}

/**
 * Notify sidebar of outbox annotation status change
 */
function notifyOutboxUpdate(annotationId: string): void {
  storage.getOutboxAnnotation(annotationId).then((annotation) => {
    if (annotation) {
      browser.runtime.sendMessage({
        type: 'OUTBOX_ANNOTATION_UPDATED',
        data: annotation,
      }).catch(() => { });
    }
  });
}

/**
 * Get all outbox annotations for a page
 */
async function handleGetOutboxAnnotations(data: {
  url: string;
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);
  const outboxAnnotations = await storage.getOutboxAnnotationsByPage(normalizedUrl);
  return { success: true, data: outboxAnnotations };
}

/**
 * Retry a failed outbox annotation
 */
async function handleRetryOutboxAnnotation(data: {
  id: string;
  title: string;
  collections?: string[];
}): Promise<MessageResponse> {
  const annotation = await storage.getOutboxAnnotation(data.id);
  if (!annotation) {
    return { success: false, error: 'Outbox annotation not found' };
  }

  const normalizedUrl = annotation.pageUrl;

  // Check if page is now saved
  const existingPage = await storage.getPage(normalizedUrl);
  if (existingPage) {
    // Page is saved - just process the annotation
    await storage.updateOutboxAnnotationStatus(data.id, 'saving_annotation');
    notifyOutboxUpdate(data.id);
    processQueuedAnnotation(data.id);
    return { success: true };
  }

  // Reset status for saving
  await storage.updateOutboxAnnotationStatus(data.id, 'saving_page');
  notifyOutboxUpdate(data.id);

  // Check if a save is already in progress
  const existingSavePromise = savesInProgress.get(normalizedUrl);
  if (existingSavePromise) {
    // Wait for existing save to complete
    existingSavePromise.then(() => {
      processQueuedAnnotation(data.id);
    });
    return { success: true };
  }

  // Start a new save
  const savePromise = startPageSaveAndProcessAnnotations(normalizedUrl, data.title, data.collections);
  savesInProgress.set(normalizedUrl, savePromise);
  savePromise.finally(() => {
    savesInProgress.delete(normalizedUrl);
  });

  return { success: true };
}

/**
 * Delete an outbox annotation (cancel pending upload)
 */
async function handleDeleteOutboxAnnotation(data: {
  id: string;
}): Promise<MessageResponse> {
  await storage.deleteOutboxAnnotation(data.id);

  browser.runtime.sendMessage({
    type: 'OUTBOX_ANNOTATION_DELETED',
    data: { id: data.id },
  }).catch(() => { });

  return { success: true };
}

// ============================================
// Tab Navigation Handling for Auto-Save
// ============================================

/**
 * Listen for tab updates to transfer pending auto-save from URL-based to tabId-based tracking.
 * When a tab loads a URL that was clicked from a saved page, we store it by tabId
 * so the content script can check on init.
 */
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only handle completed navigation with a URL
  const LOG_LEVEL = 0;
  if (LOG_LEVEL > 0) console.log("[webtero bg] tabs.onUpdated");
  if (changeInfo.status !== 'complete' || !tab.url) {
    if (LOG_LEVEL > 2) console.log("[webtero bg] tabs.onUpdated: Aborted.  status wasn't complete or tab url was falsey:", changeInfo, tab.url);
    return
  };

  // Skip internal pages
  if (tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) return;

  const normalizedUrl = normalizeUrl(tab.url);

  // Check if this URL has a pending auto-save request (from link click)
  if (pendingAutoSaveByUrl) {
    if (Date.now() < pendingAutoSaveByUrl.expires) {
      // Transfer to tabId-based tracking for content script to check
      pendingAutoSaveParents.set(tabId, {
        sourceItemKey: pendingAutoSaveByUrl.sourceItemKey,
        sourceUrl: pendingAutoSaveByUrl.sourceUrl,
        expires: Date.now() + AUTO_SAVE_DELAY_MS + 10000, // Extend expiry for content script
      });

      // Also enable auto-save mode for this tab (for link tracking)
      await storage.saveAutoSaveTab({
        tabId,
        sourceItemKey: pendingAutoSaveByUrl.sourceItemKey,
        sourceUrl: pendingAutoSaveByUrl.sourceUrl,
        enabled: true,
      });

      // Try to inject content script in case it didn't load
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          files: ['content/content.js'],
        });
        if (LOG_LEVEL > 0) console.log(`Webtero: Re-injected content script into tab ${tabId}`);
      } catch {
        // Content script may already be loaded
        if (LOG_LEVEL > 0) console.log(`Webtero: Content script injection skipped (may already be loaded)`);
      }
    } else {
      // it's expired
      pendingAutoSaveByUrl = null;
    }
  } else {
    if (LOG_LEVEL > 0) {
      console.log(`[webtero bg] tabs.onUpdated: No pending auto-save for ${normalizedUrl}`);
    }
  }
});
