import type { Message, MessageResponse, OutboxAnnotation, HighlightColor, PendingAutosaveByUrl } from '../lib/types';
import { storage } from '../lib/storage';
import { zoteroAPI } from '../lib/zotero-api';
import { atlosAPI } from '../lib/atlos-api';
import { generateId, normalizeUrl, md5 } from '../lib/utils';
import { config } from '../lib/config';
import * as zoteroOAuth from '../lib/zotero-oauth';

const LOG_LEVEL = 0;

let selectedProjects: string[] = [];

// Track pages currently being saved (URL -> Promise that resolves when save completes)
// This prevents multiple saves when annotations are queued rapidly
const savesInProgress = new Map<string, Promise<void>>();

// Track pending auto-save by target URL (set when link is clicked)
// When onUpdated fires with a matching URL, we transfer to pendingAutoSaveParents by tabId
let pendingAutoSaveByUrl: PendingAutosaveByUrl | null = null; // { sourceItemKey: string; sourceUrl: string; expires: number };

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
            message.data as { url: string; title: string; }
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

        case 'SET_SIDEBAR_SELECTED_PROJECTS':
          return await handleSetProjects(
            message.data as { projects: string[] }
          );


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
  const page = await storage.getPagesForAURL(normalizedUrl);
  const annotations = await storage.getAnnotationsByPage(normalizedUrl);

  // Fetch snapshots if page exists in Zotero
  let snapshots: Array<{
    key: string;
    title: string;
    dateAdded: string;
    url: string;
  }> = [];
  for (const p of page ?? []) {
    if (p?.backend == 'zotero' && p?.key) {
      try {
        const zoteroSnapshots = await zoteroAPI.getSnapshots(p.key);
        snapshots = zoteroSnapshots.map((s) => ({
          key: s.key,
          title: s.data.title || 'Snapshot',
          dateAdded: s.data.dateAdded ? String(s.data.dateAdded) : '',
          url: s.data.url || normalizedUrl,
        }));
      } catch (error) {
        console.error('Failed to fetch snapshots:', error);
      }
    } else if (p?.backend == 'atlos' && p?.altosIncidentSlug) {
      const incidentComments = await atlosAPI.getComments(p.altosIncidentSlug);
      snapshots = incidentComments.map((c) => ({
        key: c.key,
        title: c.title || 'Comment',
        dateAdded: c.dateAdded ? String(c.dateAdded) : '',
        url: normalizedUrl,
      }));
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
  tabId?: number; // Optional: specific tab to capture from (for auto-save)
  html?: string; // Optional: pre-captured HTML (for auto-save from content script)
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);
  const projects = selectedProjects;
  const existingPages = await storage.getPagesForAURL(normalizedUrl);

  const confirmedCollections = [];

  let snapshotSaved = false;

  const zoteroWebpageItems = [];
  const atlosSourceMaterial = [];

  let atlosDescription = '';
  let atlosSensitivity = ['Not Sensitive'];

  // for each projects

  console.log('[wt bg] Received SAVE_PAGE for', normalizedUrl, 'with projects:', projects, 'existingPages:', existingPages);

  for (const pName of projects ?? []) {
    const project = await storage.getProject(pName);
    if (!project) {
      handleSyncZoteroProjects();
      handleSyncAtlosProjects();
      return { success: false, error: `Project not found: ${pName}` };
    }
    if (project.backend === 'zotero') {

      // Check if an item already exists for this URL
      let item: Awaited<ReturnType<typeof zoteroAPI.findItemByUrl>> = null;


      // First check local storage for existing item key

      for (const existingPage of existingPages ?? []) {
        if (existingPage?.key && existingPage.backend === 'zotero') {
          try {
            item = await zoteroAPI.getItem(existingPage.key);
            // sleep for 100 ms
            await new Promise(resolve => setTimeout(resolve, 100));
            if (LOG_LEVEL > 0) console.log('Found existing item from local storage:', item.key);
            break;
          } catch (error) {
            console.error('Failed to fetch existing item from storage:', error);
          // Item may have been deleted from Zotero, fall through to search/create
          }
        }
      }

      // Fall back to API search if not found locally
      if (!item) {
        item = await zoteroAPI.findItemByUrl(normalizedUrl);
        // sleep for 100 ms
        await new Promise(resolve => setTimeout(resolve, 100));
        if (item) {
          if (LOG_LEVEL > 0) console.log('Found existing item from API search:', item.key);
        }
      }

      // Create new item if none found
      if (!item) {
        item = await zoteroAPI.createWebpageItem(
          normalizedUrl,
          data.title,
          projects
        );
        // sleep for 100 ms
        await new Promise(resolve => setTimeout(resolve, 100));
        if (LOG_LEVEL > 0) console.log('Created new item:', item.key);

      }

      // Extract confirmed collections from API response
      confirmedCollections.push(...(item.data.collections ?? []));
      zoteroWebpageItems.push(item);
    }
    else if (project.backend === 'atlos') {

      if (atlosDescription == '') {
        atlosDescription = prompt('Atlos requires a description for the new source material:') || "";
      }

      const source = await atlosAPI.createWebpageItem(
        normalizedUrl, data.title, atlosDescription, project);
      // sleep for 100 ms
      await new Promise(resolve => setTimeout(resolve, 100));
      atlosSourceMaterial.push({ projectID: project.id, projectName: project.name, sourceID: source.id });

      await handleSyncAtlosProjects();
    }

    const zoteroAttachmentKeys = [];
    const atlosSourceMaterialIncidentSlugs = [];

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

        // Zotero:
        for (const item of zoteroWebpageItems) {
          // Get existing snapshots to determine the next snapshot number
          const existingSnapshots = await zoteroAPI.getSnapshots(item.key);
          let snapshotNumber = existingSnapshots.length + 1;
          while (existingSnapshots.find(s => s.data.title === `Snapshot ${snapshotNumber}`)) {
            snapshotNumber++;
          }
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
          if (LOG_LEVEL > 0) console.log('Zotero Snapshot saved successfully:', filename);
          zoteroAttachmentKeys.push({ key: attachment.key, version: item.version });
        }
        // Atlos:
        for (const source of atlosSourceMaterial) {
          const auth = await storage.getAuthAtlosByProject(source.projectName);
          if (!auth) {
            throw new Error(`No API key found for project: ${project.name}`);
          }
          const apiKey = auth.apiKey;
          // Upload the HTML content
          await atlosAPI.createSourceMaterialArtifact(
            apiKey,
            source.sourceID,
            htmlData,
            filename,
            data.title
          );
          atlosSourceMaterialIncidentSlugs.push({ slug: source.incidentSlug, projectID: source.projectID });
        }
      }
    } catch (error) {
      // Log error but don't fail the save operation
      console.error('Failed to save snapshot:', error);
    }
    for (const item of zoteroAttachmentKeys) {
      await storage.savePage({
        url: normalizedUrl,
        backend: 'zotero',
        key: item.key,
        title: data.title,
        projects: confirmedCollections,
        dateAdded: new Date().toISOString(),
        snapshot: snapshotSaved,
        zoteroVersion: item.version,
      });
    }
    for (const item of atlosSourceMaterialIncidentSlugs) {
      await storage.savePage({
        url: normalizedUrl,
        key: item.slug + item.projectID,
        backend: 'atlos',
        altosIncidentSlug: item.slug,
        altosSourceMaterialID: item.projectID,
        title: data.title,
        dateAdded: new Date().toISOString(),
        snapshot: snapshotSaved,
      });
    }
  }
  return {
    success: true,
    data: { projects: confirmedCollections, snapshot: snapshotSaved },
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
  projects?: string[];
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);



  // Get the page to find the Zotero item key
  const pages = await storage.getPagesForAURL(normalizedUrl);
  if (!pages || pages.length === 0) {
    return { success: false, error: 'Page not saved to Zotero yet' };
  }

  // get the most recent backend=zotero from pages
  const page = pages.filter(p => p.backend === 'zotero').sort((a, b) => {
    return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
  })[0];

  // Get the most recent snapshot to associate the annotation with locally
  let snapshotKey: string | undefined;
  try {
    const snapshots = await zoteroAPI.getSnapshots(page.key);
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
    zoteroItemKey: page.key,
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
  // Get all existing projects
  const allProjects = await storage.getAllProjects();

  // Remove all Zotero projects (keep non-Zotero projects)
  const projects: Record<string, any> = {};
  for (const [id, project] of Object.entries(allProjects)) {
    if (project.backend !== 'zotero') {
      projects[id] = project;
    }
  }

  // Fetch collections from Zotero
  const collections = await zoteroAPI.getCollections();

  // Add Zotero projects
  for (const collection of collections) {
    projects[collection.key] = {
      backend: 'zotero',
      id: collection.key,
      name: collection.data.name,
      parentId: collection.data.parentCollection || undefined,
      itemCount: collection.meta?.numItems ?? 0,
      version: collection.version,
      dateModified: Date.parse(collection.data.dateModified || ''),
    };
  }

  // Save to storage
  await storage.saveProjects(projects);
  await storage.setLastSyncZotero(new Date().toISOString());

  return {
    success: true,
    data: projects,
  };
}

async function handleSyncAtlosProjects(): Promise<MessageResponse> {
  let count = 0;
  // 1) Get all projects from Webtero
  const allProjects = await storage.getAllProjects();

  // 2) Remove all Atlos projects
  const projects: Record<string, any> = {};
  for (const [id, project] of Object.entries(allProjects)) {
    if (project.backend !== 'atlos') {
      projects[id] = project;
    }
  }

  // Get all API keys
  const apiKeys = await storage.getAllAuthAtlos();

  // 3) Create parent project for each API key
  for (const auth of apiKeys) {
    const parentId = `${auth.projectName}`;

    // Create parent project
    projects[parentId] = {
      backend: 'atlos',
      id: parentId,
      name: auth.projectName,
      parentId: undefined,
      itemCount: 0,
      version: 0,
    };

    // 4) With a 1 second await between each parent, query the API for incidents
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      // Query API for incidents (first page, already sorted by most recently updated)
      const incidents = await atlosAPI.getProjectIncidents(auth.projectName);

      // Add incidents as child projects
      for (const incident of incidents) {
        count++;
        projects[incident.id] = incident;
      }

      // Update parent item count
      projects[parentId].itemCount = incidents.length;

      // update parent last modified to the first incident's dateModified
      if (incidents.length > 0) {
        projects[parentId].dateModified = incidents[0].dateModified;
      }
    } catch (error) {
      console.error(`Failed to fetch incidents for ${auth.projectName}:`, error);
      // Continue with other projects even if one fails
    }
  }

  // 5) Save
  await storage.saveProjects(projects);
  await storage.setLastSyncAtlos(new Date().toISOString());

  return {
    success: true,
    data: projects,
    count: count
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
    const page = await storage.getPagesForAURL(annotation.pageUrl);
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
  const existingPages = await storage.getPagesForAURL(normalizedUrl);
  if (existingPages) {
    if (LOG_LEVEL > 0) console.log(`Webtero: Page already saved, creating link record only`);

    const existingPage = existingPages.find(p => p.backend === 'zotero');
    if (!existingPage) {
      return { success: false, error: 'Existing saved page not found in Zotero' };
    }

    // Get the source item key from the auto-save tab info
    const autoSaveTab = await storage.getAutoSaveTab(tabId);
    if (autoSaveTab) {
      const link = {
        id: generateId(),
        sourceItemKey: autoSaveTab.sourceItemKey,
        targetItemKey: existingPage.key,
        targetUrl: normalizedUrl,
        created: new Date().toISOString(),
      };
      await storage.savePageLink(link);
    }

    return { success: true, data: { alreadySaved: true, itemKey: existingPage.key } };
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
    const savedPages = await storage.getPagesForAURL(normalizedUrl);


    if (savedPages) {
      const savedPage = savedPages.find(p => p.backend === 'zotero');
      if (!savedPage) {
        throw new Error('Saved page not found in Zotero after save');
      }
      // Create link record
      const link = {
        id: generateId(),
        sourceItemKey: autoSaveTab.sourceItemKey,
        targetItemKey: savedPage.key,
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
  const existingPages = await storage.getPagesForAURL(targetUrl);

  if (existingPages) {
    if (LOG_LEVEL > 0) console.log(`[webtero bg] handleLinkClicked: Target page already saved, creating link record`);

    const existingPage = existingPages.find(p => p.backend === 'zotero');
    if (!existingPage) {
      if (LOG_LEVEL > 0) console.log(`[webtero bg] handleLinkClicked: Existing saved page not found in Zotero`);
      return { success: false, error: 'Existing saved page not found in Zotero' };
    }
    // Create a link record for already-saved page
    const link = {
      id: generateId(),
      sourceItemKey: sourceItemKey,
      targetItemKey: existingPage.key,
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
      (p) => p[0].key === link.sourceItemKey
    );
    if (sourcePage) {
      linkedPages.push({
        itemKey: link.sourceItemKey,
        url: sourcePage[0].url,
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
      ? await storage.getReadPercentage(page[0].url)
      : 0;

    // Get annotation colors for this page
    const pageAnnotations = Object.values(allAnnotations).filter(
      (ann) => ann.pageUrl === page[0].url
    );
    const annotationColors = pageAnnotations.map((ann) => ann.color);

    savedUrls.push({
      url: page[0].url,
      itemKey: page[0].key,
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
// Set projects
// ============================================
async function handleSetProjects(data: {
  projects: string[];
}): Promise<MessageResponse> {
  const projectRecords = await storage.getAllProjects();
  const validProjects = data.projects.filter(projId => projId in projectRecords);

  selectedProjects = validProjects;

  return {
    success: true,
  };
}


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
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);

  // Case 3: Page already saved - create annotation directly on latest snapshot
  const existingPages = await storage.getPagesForAURL(normalizedUrl);
  if (existingPages && existingPages.length > 0) {
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
  const savePromise = startPageSaveAndProcessAnnotations(normalizedUrl, data.title);
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
): Promise<void> {
  try {
    // Save the page first
    const saveResult = await handleSavePage({
      url: normalizedUrl,
      title: pageTitle,
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
  const existingPage = await storage.getPagesForAURL(normalizedUrl);
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
  const savePromise = startPageSaveAndProcessAnnotations(normalizedUrl, data.title);
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
