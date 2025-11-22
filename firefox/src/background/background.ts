import type { Message, MessageResponse } from '../lib/types';
import { storage } from '../lib/storage';
import { zoteroAPI } from '../lib/zotero-api';
import { generateId, normalizeUrl } from '../lib/utils';

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

  return {
    success: true,
    data: {
      page,
      annotations,
    },
  };
}

/**
 * Save a page to Zotero
 */
async function handleSavePage(data: {
  url: string;
  title: string;
  collections?: string[];
}): Promise<MessageResponse> {
  const normalizedUrl = normalizeUrl(data.url);
  const collections = data.collections;

  // Create webpage item via Web API
  const item = await zoteroAPI.createWebpageItem(
    normalizedUrl,
    data.title,
    collections
  );

  // Save to local storage
  await storage.savePage({
    url: normalizedUrl,
    zoteroItemKey: item.key,
    title: data.title,
    projects: collections ?? [],
    dateAdded: new Date().toISOString(),
    snapshot: false,
    version: item.version,
  });

  return {
    success: true,
    data: { itemKey: item.key },
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

  // Create annotation in Zotero
  const note = await zoteroAPI.createAnnotation(
    page.zoteroItemKey,
    data.text,
    data.comment,
    data.color
  );

  // Save annotation locally
  const annotation = {
    id: generateId(),
    pageUrl: normalizedUrl,
    zoteroItemKey: page.zoteroItemKey,
    zoteroNoteKey: note.key,
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
 */
async function handleSyncProjects(): Promise<MessageResponse> {
  const collections = await zoteroAPI.getCollections();

  // Convert to our project format
  const projects: Record<string, any> = {};
  for (const collection of collections) {
    projects[collection.key] = {
      id: collection.key,
      name: collection.data.name,
      parentId: collection.data.parentCollection,
      itemCount: 0, // TODO: Fetch actual count
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
