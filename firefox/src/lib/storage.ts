import type {
  StorageData,
  AuthData,
  SavedPage,
  Annotation,
  Project,
} from './types';

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

  // Utility
  async clear(): Promise<void> {
    await browser.storage.local.clear();
  }
}

export const storage = new Storage();
