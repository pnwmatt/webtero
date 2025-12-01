import { storage } from './storage';
import { getColorHex } from './utils';
import type { WebteroProject } from './types';

const API_BASE = 'https://platform.atlos.org/api/v2/';
const API_VERSION = '3';

/**
 * Atlos Web API client
 */
class AtlosAPI {
  private async getHeaders(apiKey: string): Promise<HeadersInit> {
    return {
      'Content-Type': 'application/json',
      'Authorization': "Bearer " + apiKey,
    };
  }

  /**
   * Fetch all incidents for a project
   * {
  "results": [
    {
      "deleted": false,
      "updated_at": "2025-11-28T03:47:43",
      "slug": "8ZTPK4",
      "attr_description": "Example summary",
      "source_material": [
        {
          "id": "1c81df48-9a44-4df2-a034-82ccbe4a0603",
        }
      ],
    }
  ]
}
   */
  async getProjectIncidents(projectName: string): Promise<WebteroProject[]> {
    const auth = await storage.getAuthAtlosByProject(projectName);
    if (!auth) {
      throw new Error(`No API key found for project: ${projectName}`);
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.apiKey}`,
    };

    const response = await fetch(`${API_BASE}incidents`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch incidents: ${response.statusText}`);
    }

    const data = await response.json();

    // Filter out deleted incidents and transform to WebteroProject format
    const projects: WebteroProject[] = data.results
      .filter((incident: any) => !incident.deleted)
      .map((incident: any) => ({
        backend: 'atlos' as const,
        id: incident.slug,
        name: incident.attr_description,
        parentId: `${projectName}`,
        dateModified: incident.updated_at,
        itemCount: incident.source_material?.length ?? 0,
        version: 0, // Atlos doesn't use versioning
      }));
    // sort by dateModified desc
    projects.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));

    return projects;
  }

  async createWebpageItem(
    url: string,
    title: string,
    description: string,
    project: WebteroProject
  ): Promise<any> {

    let slug = project.id;
    console.log("[wt bg] atlos: createWebpageItem for project:", project);

    const auth = await storage.getAuthAtlosByProject(project.name);
    if (!auth) {
      throw new Error(`No API key found for project: ${project.name}`);
    }
    const apiKey = auth.apiKey;

    if (project.parentId === undefined) {
      // Create a new incident
      const result = await this.createAtlosIncident(
        apiKey,
        project.id,
        title,
        ['Not Sensitive'],
      );
      console.log("[wt bg] atlos: Created new incident for webpage item:", result);
      slug = result.result.slug;
    } else {
      console.log('[wt bg] atlos: Using existing incident slug for webpage item:', slug);
    }

    console.log("[wt bg] atlos: Creating source material for incident slug:", slug);
    // Create source material for existing incident
    const result = await this.createAtlosSourceMaterial(
      apiKey,
      slug, // incident slug
      description,
      url
    );

    return result;

  }


  /* Create an Atlos Incident
   * POST /api/v2/incidents/new creates a new incident. It has two required parameters:

    description, the incident's description. description should be a string of at least 8 characters.
    sensitive, a string array of the incident's sensitivity. That should be either ["Not Sensitive"], or any combination of the values ["Graphic Violence", "Deceptive or Misleading", "Personal Information Visible"].
    */
  async createAtlosIncident(
    apiKey: string,
    webteroProjectName: string,
    description: string,
    sensitive: string[],
  ): Promise<any> {


    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    console.log("[wt bg] atlos: createAtlosIncident for project:", webteroProjectName);
    // Create the incident
    const response = await fetch(`${API_BASE}incidents/new`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description,
        sensitive,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create incident: ${response.statusText}`);
    }

    const incident = await response.json();
    console.log("[wt bg] atlos: Created incident:", incident);

    // Get the first source_material ID and call createSourceMaterialArtifact with that id
    if (incident.source_material && incident.source_material.length > 0) {
      const sourceMaterialId = incident.source_material[0].id;
      console.log("[wt bg] atlos: Created incident with source material ID:", sourceMaterialId);
      // Note: createSourceMaterialArtifact would need singlePageData parameter
      // This is a placeholder - actual implementation depends on how singlePageData is obtained
      // await this.createSourceMaterialArtifact(sourceMaterialId, singlePageData);
    }

    return incident;
  }
  /*
   * POST /api/v2/source_material/new/:slug creates a new piece of source material in the already-existing incident with slug :slug.
  The API accepts the param
  */
  async createAtlosSourceMaterial(
    apiKey: string,
    atlosSlug: string,
    description: string,
    url: string
  ): Promise<any> {

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    const response = await fetch(`${API_BASE}source_material/new/${atlosSlug}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description,
        url,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create source material: ${response.statusText}`);
    }

    const sourceMaterial = await response.json();
    if (sourceMaterial.success) {
      console.log("[wt bg] atlos: Created source material:", sourceMaterial);
      return sourceMaterial.result;
    } else {
      console.error("[wt bg] atlos: Failed to create source material:", sourceMaterial);
    }

  }

  /* Artifacts always belong to a piece of source material.
  POST /api/v2/source_material/upload/:id uploads a file to the piece of source material with ID :id. This endpoint has two parameters:

    file, which should be sent as a multipart form request (required).
    title, the title of the webpage
    */

  async createSourceMaterialArtifact(
    apiKey: string,
    sourceMaterialId: string,
    singlePageData: Uint8Array<ArrayBuffer>,
    filename: string,
    title?: string
  ): Promise<boolean> {
    const headers = await this.getHeaders(apiKey);
    delete (headers as any)['Content-Type']; // Remove Content-Type as it will be set by browser for multipart/form-data

    const formData = new FormData();
    const blob = new Blob([singlePageData], { type: 'application/octet-stream' });
    formData.append('file', blob, filename);

    if (title) {
      formData.append('title', title);
    }

    const response = await fetch(`${API_BASE}source_material/upload/${sourceMaterialId}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload artifact: ${response.statusText}`);
    }

    return true;
  }

  /**
   * Annotations are created as comments on the Incident
   * POST /api/v2/add_comment/:slug adds a comment to the incident with slug :slug. This endpoint has one required parameter:

    message contains the string contents of the comment.
   */
  async createAnnotation(
    incidentSlug: string,
    text: string,
    color: string,
    sourceMaterialUUID: string,
    url: string
  ): Promise<any> {
    // Extract project name from the slug to get the correct API key
    const allProjects = await storage.getAllProjects();
    let projectName: string | undefined;

    for (const [_id, project] of Object.entries(allProjects)) {
      if (project.id === incidentSlug && project.backend === 'atlos') {
        projectName = project.parentId;
        break;
      }
    }

    if (!projectName) {
      throw new Error(`Could not find project for incident slug in createAnnotation: ${incidentSlug}`);
    }

    const auth = await storage.getAuthAtlosByProject(projectName);
    if (!auth) {
      throw new Error(`No API key found for project: ${projectName}`);
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.apiKey}`,
    };

    // Format the message with quoted text and metadata
    // use `> ` to prefix the text being quoted.
    // then on a new line the capitalized annotation color, the url, and the sourceMaterial UUID
    // Example:
    // > This is my highlighted text
    // YELLOW https://example.com 1c81df48-9a44-4df2-a034-82ccbe4a0603
    const message = `> ${text}\n${color.toUpperCase()} ${url} ${sourceMaterialUUID}`;

    const response = await fetch(`${API_BASE}add_comment/${incidentSlug}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create annotation: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  }

  /**
   * Get comments (annotations) for a particular incident
   * GET /api/v2/updates returns all updates (including comments) in a project.

    Filter— (e.g., /api/v2/updates?slug=incident-slug)
   */
  async getComments(slug: string): Promise<any[]> {
    // Extract project name from the slug to get the correct API key
    const allProjects = await storage.getAllProjects();
    let projectName: string | undefined;

    for (const [_id, project] of Object.entries(allProjects)) {
      if (project.id === slug && project.backend === 'atlos') {
        projectName = project.parentId;
        break;
      }
    }

    if (!projectName) {
      throw new Error(`Could not find project for incident slug in getComments: ${slug}`);
    }

    const auth = await storage.getAuthAtlosByProject(projectName);
    if (!auth) {
      throw new Error(`No API key found for project: ${projectName}`);
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.apiKey}`,
    };

    const response = await fetch(`${API_BASE}updates?slug=${slug}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.statusText}`);
    }

    const data = await response.json();
    return data.results || [];
  }

}

export const atlosAPI = new AtlosAPI();
