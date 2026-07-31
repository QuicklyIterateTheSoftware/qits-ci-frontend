import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  ProjectDto,
  ProjectEntriesResponse,
  RepositoryDto,
  RepositoryEntriesResponse,
} from './dto';

/**
 * The two reads this app makes against qits-projects: the project spine of the tree, and one
 * project's repositories when it is expanded.
 *
 * This service is duplicated in qits-spa-cd rather than shared. It is roughly forty lines, and the
 * alternative — putting it in `@qits/ui-components` — would push a transport dependency into six
 * SPAs that make no requests, and turn every change to it into a library publish plus a version
 * bump in seven applications. The platform's own precedent is the same: qits-ci duplicates
 * qits-events' wire contract as its own DTOs rather than depending on the domain module.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** Every project. One request, on page load, and the only unrecoverable failure on the tree. */
  async projects(): Promise<readonly ProjectDto[]> {
    const response = await firstValueFrom(
      this.http.get<ProjectEntriesResponse>(`${this.base}/projects/api/projects`),
    );
    return response.entries.map((entry) => entry.project);
  }

  /** One project's repositories, fetched when that project is expanded and never before. */
  async repositories(projectId: string): Promise<readonly RepositoryDto[]> {
    const response = await firstValueFrom(
      this.http.get<RepositoryEntriesResponse>(
        `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/repositories`,
      ),
    );
    return response.entries.map((entry) => entry.repository);
  }
}
