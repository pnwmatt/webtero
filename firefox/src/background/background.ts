import type { Message, MessageResponse, OutboxAnnotation, HighlightColor } from '../lib/types';
import { storage } from '../lib/storage';
import { zoteroAPI } from '../lib/zotero-api';
import { generateId, normalizeUrl, md5 } from '../lib/utils';
import { config } from '../lib/config';
import * as zoteroOAuth from '../lib/zotero-oauth';

console.log('Webtero background script loaded');

/**
 * Handle messages from sidebar and content scripts
 */
browser.runtime.onMessage.addListener(
  async (
    message: Message,
    sender: browser.runtime.MessageSender
  ): Promise<MessageResponse> => {
    console.log('Background received message:', message.type);

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

        case 'SYNC_PROJECTS':
          return await handleSyncProjects();

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
            message.data as { tabId: number }
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
      console.log('Found existing item from local storage:', item.key);
    } catch (error) {
      console.error('Failed to fetch existing item from storage:', error);
      // Item may have been deleted from Zotero, fall through to search/create
    }
  }

  // Fall back to API search if not found locally
  if (!item) {
    item = await zoteroAPI.findItemByUrl(normalizedUrl);
    if (item) {
      console.log('Found existing item from API search:', item.key);
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
    console.log('Created new item:', item.key);
  }

  // Extract confirmed collections from API response
  const confirmedCollections = item.data.collections ?? [];

  let snapshotSaved = false;

  // Try to capture and upload snapshot
  try {
    // Get active tab to capture HTML
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (activeTab?.id) {
      // Request HTML capture from content script
      const captureResponse = await browser.tabs.sendMessage(activeTab.id, {
        type: 'CAPTURE_PAGE_HTML',
      });

      if (captureResponse?.success && captureResponse.data) {
        const htmlContent = captureResponse.data as string;

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

        // Determine attachment title
        // If existing item has different title, use "Snapshot: <new title>"
        let attachmentTitle = 'Snapshot';
        if (isExistingItem && item.data.title !== data.title) {
          attachmentTitle = `Snapshot: ${data.title}`;
        }

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
        console.log('Snapshot saved successfully:', filename, isExistingItem ? '(added to existing item)' : '(new item)');
      }
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
  position: { xpath: string; offset: number; length: number };
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

  // Create annotation in Zotero as a child of the parent webpage item
  // (Zotero API doesn't allow notes as children of attachments)
  const note = await zoteroAPI.createAnnotation(
    page.zoteroItemKey,
    data.text,
    data.comment,
    data.color
  );

  // Save annotation locally with snapshot association for tracking
  const annotation = {
    id: generateId(),
    pageUrl: normalizedUrl,
    zoteroItemKey: page.zoteroItemKey,
    zoteroNoteKey: note.key,
    snapshotKey, // Associate with snapshot locally
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
async function handleSyncProjects(): Promise<MessageResponse> {
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

  console.log('Webtero: Starting focus session for', data.itemKey, 'in tab', tabId);

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
async function handleCheckAutoSave(data: {
  tabId: number;
}): Promise<MessageResponse> {
  const tab = await storage.getAutoSaveTab(data.tabId);
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
 * Handle a link click from a page with auto-save enabled
 * Auto-saves the target page and creates a link record
 */
async function handleLinkClicked(
  data: { tabId: number; targetUrl: string },
  sender: browser.runtime.MessageSender
): Promise<MessageResponse> {
  const autoSaveTab = await storage.getAutoSaveTab(data.tabId);
  if (!autoSaveTab?.enabled) {
    return { success: false, error: 'Auto-save not enabled for this tab' };
  }

  const targetUrl = normalizeUrl(data.targetUrl);

  // Check if target page is already saved
  let targetPage = await storage.getPage(targetUrl);

  // If not saved, save it now
  if (!targetPage) {
    // We need to wait for the page to load to get the title
    // For now, use the URL as title - content script will update after load
    const result = await handleSavePage({
      url: targetUrl,
      title: targetUrl, // Will be updated by content script
      collections: [], // Use same collections as source? TBD
    });

    if (!result.success) {
      return result;
    }

    targetPage = await storage.getPage(targetUrl);
  }

  if (targetPage) {
    // Create a link record
    const link = {
      id: generateId(),
      sourceItemKey: autoSaveTab.sourceItemKey,
      targetItemKey: targetPage.zoteroItemKey,
      targetUrl: targetUrl,
      created: new Date().toISOString(),
    };

    await storage.savePageLink(link);

    // Enable auto-save for the new tab (link clicks typically open in new tab or navigate)
    // The content script will handle enabling auto-save when the page loads

    return { success: true, data: { link, targetPage } };
  }

  return { success: false, error: 'Failed to save target page' };
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
  const savedUrls: Array<{
    url: string;
    itemKey: string;
    readPercentage: number;
    annotationColors: string[];
  }> = [];

  for (const page of Object.values(pages)) {
    const percentage = await storage.getReadPercentage(page.zoteroItemKey);

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

  return { success: true, data: savedUrls };
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
 * If the page isn't saved, this triggers saving it first
 */
async function handleQueueAnnotation(data: {
  url: string;
  title: string;
  text: string;
  comment?: string;
  color: string;
  position: { xpath: string; offset: number; length: number };
  collections?: string[];
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);

  // Check if page is already saved
  const existingPage = await storage.getPage(normalizedUrl);

  if (existingPage) {
    // Page already saved, create annotation directly
    return await handleCreateAnnotation({
      url: data.url,
      text: data.text,
      comment: data.comment,
      color: data.color,
      position: data.position,
    });
  }

  // Page not saved - queue the annotation and start page save
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

  // Start saving the page in the background
  processOutboxAnnotation(outboxAnnotation.id, data.title, data.collections);

  return {
    success: true,
    data: { queued: true, annotation: outboxAnnotation },
  };
}

/**
 * Process a queued annotation: save page, then create annotation
 */
async function processOutboxAnnotation(
  annotationId: string,
  pageTitle: string,
  collections?: string[]
): Promise<void> {
  const outboxAnnotation = await storage.getOutboxAnnotation(annotationId);
  if (!outboxAnnotation) return;

  try {
    // Save the page first
    const saveResult = await handleSavePage({
      url: outboxAnnotation.pageUrl,
      title: pageTitle,
      collections,
    });

    if (!saveResult.success) {
      await storage.updateOutboxAnnotationStatus(
        annotationId,
        'failed',
        saveResult.error || 'Failed to save page'
      );
      notifyOutboxUpdate(annotationId);
      return;
    }

    // Page saved, now create the annotation
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
    }).catch(() => {});

  } catch (error) {
    console.error('Failed to process outbox annotation:', error);
    await storage.updateOutboxAnnotationStatus(
      annotationId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
    notifyOutboxUpdate(annotationId);
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
      }).catch(() => {});
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

  // Reset status and retry
  await storage.updateOutboxAnnotationStatus(data.id, 'saving_page');
  notifyOutboxUpdate(data.id);

  processOutboxAnnotation(data.id, data.title, data.collections);

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
  }).catch(() => {});

  return { success: true };
}
