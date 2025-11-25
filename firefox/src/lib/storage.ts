import type {
  StorageData,
  AuthData,
  SavedPage,
  Annotation,
  Project,
  PageFocusSession,
  PageLink,
  AutoSaveTab,
  OutboxAnnotation,
  Settings,
} from './types';
import { DEFAULT_SETTINGS } from './types';

const LOG_LEVEL = 0;

/**
 * Storage abstraction layer using browser.storage.local
 */
class Storage {
  private async get<K extends keyof StorageData>(
    key: K
  ): Promise<StorageData[K] | undefined> {
    const result = await browser.storage.local.get(key);
    return result[key];
  }

  private async set<K extends keyof StorageData>(
    key: K,
    value: StorageData[K]
  ): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  }

  // Auth operations
  async getAuth(): Promise<AuthData | undefined> {
    return this.get('auth');
  }

  async setAuth(auth: AuthData): Promise<void> {
    await this.set('auth', auth);
  }

  async clearAuth(): Promise<void> {
    await browser.storage.local.remove('auth');
  }

  // Page operations
  async getPage(url: string): Promise<SavedPage | undefined> {
    const pages = await this.get('pages');
    return pages?.[url];
  }

  async getAllPages(): Promise<Record<string, SavedPage>> {
    return (await this.get('pages')) ?? {};
  }

  async savePage(page: SavedPage): Promise<void> {
    const pages = (await this.get('pages')) ?? {};
    pages[page.url] = page;
    await this.set('pages', pages);
  }

  async deletePage(url: string): Promise<void> {
    const pages = await this.get('pages');
    if (pages && pages[url]) {
      delete pages[url];
      await this.set('pages', pages);
    }
  }

  // Annotation operations
  async getAnnotation(id: string): Promise<Annotation | undefined> {
    const annotations = await this.get('annotations');
    return annotations?.[id];
  }

  async getAnnotationsByPage(url: string): Promise<Annotation[]> {
    const annotations = await this.get('annotations');
    if (!annotations) return [];
    return Object.values(annotations).filter((ann) => ann.pageUrl === url);
  }

  async getAnnotationsBySnapshot(snapshotKey: string): Promise<Annotation[]> {
    const annotations = await this.get('annotations');
    if (!annotations) return [];
    return Object.values(annotations).filter((ann) => ann.snapshotKey === snapshotKey);
  }

  async getAllAnnotations(): Promise<Record<string, Annotation>> {
    return (await this.get('annotations')) ?? {};
  }

  async saveAnnotation(annotation: Annotation): Promise<void> {
    const annotations = (await this.get('annotations')) ?? {};
    annotations[annotation.id] = annotation;
    await this.set('annotations', annotations);
  }

  async deleteAnnotation(id: string): Promise<void> {
    const annotations = await this.get('annotations');
    if (annotations && annotations[id]) {
      delete annotations[id];
      await this.set('annotations', annotations);
    }
  }

  // Project operations
  async getProject(id: string): Promise<Project | undefined> {
    const projects = await this.get('projects');
    return projects?.[id];
  }

  async getAllProjects(): Promise<Record<string, Project>> {
    return (await this.get('projects')) ?? {};
  }

  async saveProject(project: Project): Promise<void> {
    const projects = (await this.get('projects')) ?? {};
    projects[project.id] = project;
    await this.set('projects', projects);
  }

  async saveProjects(projectsData: Record<string, Project>): Promise<void> {
    await this.set('projects', projectsData);
  }

  async deleteProject(id: string): Promise<void> {
    const projects = await this.get('projects');
    if (projects && projects[id]) {
      delete projects[id];
      await this.set('projects', projects);
    }
  }

  // Sync operations
  async getLastSync(): Promise<string | undefined> {
    return this.get('lastSync');
  }

  async setLastSync(timestamp: string): Promise<void> {
    await this.set('lastSync', timestamp);
  }

  // Page Focus Session operations
  async getFocusSession(id: string): Promise<PageFocusSession | undefined> {
    const sessions = await this.get('pageFocusSessions');
    return sessions?.[id];
  }

  async getFocusSessionsByItem(itemKey: string): Promise<PageFocusSession[]> {
    const sessions = await this.get('pageFocusSessions');
    if (!sessions) return [];
    return Object.values(sessions).filter((s) => s.itemKey === itemKey);
  }

  async getActiveFocusSession(tabId: number): Promise<PageFocusSession | undefined> {
    const sessions = await this.get('pageFocusSessions');
    if (!sessions) return undefined;
    return Object.values(sessions).find((s) => s.tabId === tabId && !s.endTime);
  }

  async saveFocusSession(session: PageFocusSession): Promise<void> {
    const sessions = (await this.get('pageFocusSessions')) ?? {};
    sessions[session.id] = session;
    await this.set('pageFocusSessions', sessions);
  }

  async deleteFocusSession(id: string): Promise<void> {
    const sessions = await this.get('pageFocusSessions');
    if (sessions && sessions[id]) {
      delete sessions[id];
      await this.set('pageFocusSessions', sessions);
    }
  }

  /**
   * Calculate total read percentage for an item by merging all session ranges
   */
  async getReadPercentage(itemKey: string): Promise<number> {
    const sessions = await this.getFocusSessionsByItem(itemKey);
    if (sessions.length === 0) return 0;

    // Collect all ranges from all sessions
    const allRanges: Array<{ start: number; end: number }> = [];
    for (const session of sessions) {
      for (const range of session.readRanges) {
        // Clone the range to avoid mutating the original
        allRanges.push({ start: range.start, end: range.end });
      }
    }

    if (allRanges.length === 0) return 0;

    // Merge overlapping ranges
    allRanges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];

    for (const range of allRanges) {
      if (merged.length === 0) {
        merged.push({ start: range.start, end: range.end });
      } else {
        const last = merged[merged.length - 1];
        if (range.start <= last.end) {
          // Overlapping or adjacent, extend the last range
          last.end = Math.max(last.end, range.end);
        } else {
          // Non-overlapping, add new range
          merged.push({ start: range.start, end: range.end });
        }
      }
    }

    // Calculate total percentage covered
    const totalCovered = merged.reduce((sum, r) => sum + (r.end - r.start), 0);
    const percentage = Math.min(100, Math.round(totalCovered));

    if (LOG_LEVEL > 0) {
      console.log(`Webtero: Read percentage for ${itemKey}:`);
      console.log(`  Sessions: ${sessions.length}, Raw ranges: ${allRanges.length}`);
      console.log(`  Merged ranges: ${JSON.stringify(merged)}`);
      console.log(`  Total covered: ${totalCovered.toFixed(1)}%, Final: ${percentage}%`);
    }

    return percentage;
  }

  // Page Link operations
  async getPageLink(id: string): Promise<PageLink | undefined> {
    const links = await this.get('pageLinks');
    return links?.[id];
  }

  async getPageLinksBySource(sourceItemKey: string): Promise<PageLink[]> {
    const links = await this.get('pageLinks');
    if (!links) return [];
    return Object.values(links).filter((l) => l.sourceItemKey === sourceItemKey);
  }

  async getPageLinksByTarget(targetItemKey: string): Promise<PageLink[]> {
    const links = await this.get('pageLinks');
    if (!links) return [];
    return Object.values(links).filter((l) => l.targetItemKey === targetItemKey);
  }

  async getAllPageLinks(): Promise<Record<string, PageLink>> {
    return (await this.get('pageLinks')) ?? {};
  }

  async savePageLink(link: PageLink): Promise<void> {
    const links = (await this.get('pageLinks')) ?? {};
    links[link.id] = link;
    await this.set('pageLinks', links);
  }

  async deletePageLink(id: string): Promise<void> {
    const links = await this.get('pageLinks');
    if (links && links[id]) {
      delete links[id];
      await this.set('pageLinks', links);
    }
  }

  // Auto-save Tab operations
  async getAutoSaveTab(tabId: number): Promise<AutoSaveTab | undefined> {
    const tabs = await this.get('autoSaveTabs');
    return tabs?.[tabId];
  }

  async getAllAutoSaveTabs(): Promise<Record<number, AutoSaveTab>> {
    return (await this.get('autoSaveTabs')) ?? {};
  }

  async saveAutoSaveTab(tab: AutoSaveTab): Promise<void> {
    const tabs = (await this.get('autoSaveTabs')) ?? {};
    tabs[tab.tabId] = tab;
    await this.set('autoSaveTabs', tabs);
  }

  async deleteAutoSaveTab(tabId: number): Promise<void> {
    const tabs = await this.get('autoSaveTabs');
    if (tabs && tabs[tabId]) {
      delete tabs[tabId];
      await this.set('autoSaveTabs', tabs);
    }
  }

  // Outbox Annotation operations
  async getOutboxAnnotation(id: string): Promise<OutboxAnnotation | undefined> {
    const outbox = await this.get('outboxAnnotations');
    return outbox?.[id];
  }

  async getOutboxAnnotationsByPage(url: string): Promise<OutboxAnnotation[]> {
    const outbox = await this.get('outboxAnnotations');
    if (!outbox) return [];
    return Object.values(outbox).filter((ann) => ann.pageUrl === url);
  }

  async getAllOutboxAnnotations(): Promise<Record<string, OutboxAnnotation>> {
    return (await this.get('outboxAnnotations')) ?? {};
  }

  async saveOutboxAnnotation(annotation: OutboxAnnotation): Promise<void> {
    const outbox = (await this.get('outboxAnnotations')) ?? {};
    outbox[annotation.id] = annotation;
    await this.set('outboxAnnotations', outbox);
  }

  async deleteOutboxAnnotation(id: string): Promise<void> {
    const outbox = await this.get('outboxAnnotations');
    if (outbox && outbox[id]) {
      delete outbox[id];
      await this.set('outboxAnnotations', outbox);
    }
  }

  async updateOutboxAnnotationStatus(
    id: string,
    status: OutboxAnnotation['status'],
    error?: string
  ): Promise<void> {
    const outbox = await this.get('outboxAnnotations');
    if (outbox && outbox[id]) {
      outbox[id].status = status;
      outbox[id].error = error;
      await this.set('outboxAnnotations', outbox);
    }
  }

  // Settings operations
  async getSettings(): Promise<Settings> {
    const settings = await this.get('settings');
    // Return defaults merged with any saved settings
    return { ...DEFAULT_SETTINGS, ...settings };
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.set('settings', settings);
  }

  async updateSettings(partial: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const updated = { ...current, ...partial };
    await this.saveSettings(updated);
    return updated;
  }

  // Utility
  async clear(): Promise<void> {
    await browser.storage.local.clear();
  }
}

export const storage = new Storage();
