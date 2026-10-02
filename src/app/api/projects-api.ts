import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import { firstValueFrom } from 'rxjs';
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
 * qits-projects answers on its own host, not this one: the edge routes an application's paths on
 * that application's host only. So every call here goes to `applications['qits-projects'].origin`
 * from the edge's `/main-navigation`, carries the session (`withCredentials` — the edge answers
 * credentialed CORS for any origin under the platform domain), and waits for the navigation to
 * answer rather than firing a relative path at this host first. Where the navigation names no
 * origin the path stays relative, same-origin — what an older edge still routes.
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
  private readonly links = inject(QitsAppLinks);

  /** `path` on qits-projects' own origin, once the navigation has said where that is. */
  private url(path: string): Promise<string> {
    return this.links.whenApiUrl('qits-projects', path);
  }

  /** Every project. One request, on page load, and the only unrecoverable failure on the tree. */
  async projects(): Promise<readonly ProjectDto[]> {
    const url = await this.url('/projects/api/projects');
    const response = await firstValueFrom(
      this.http.get<ProjectEntriesResponse>(url, { withCredentials: true }),
    );
    return response.entries.map((entry) => entry.project);
  }

  /** One project's repositories, fetched when that project is expanded and never before. */
  async repositories(projectId: string): Promise<readonly RepositoryDto[]> {
    const url = await this.url(
      `/projects/api/projects/${encodeURIComponent(projectId)}/repositories`,
    );
    const response = await firstValueFrom(
      this.http.get<RepositoryEntriesResponse>(url, { withCredentials: true }),
    );
    return response.entries.map((entry) => entry.repository);
  }
}
