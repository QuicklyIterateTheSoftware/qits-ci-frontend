import { Injectable, inject } from '@angular/core';
import type { ProjectDto, RepositoryDto } from './dto';
import { ProjectsApi } from './projects-api';

/**
 * Which project claims which repository id — the one join qits-ci cannot make for itself.
 *
 * A `CiRun` is keyed by `repoId`, which is the shared git-host directory name, and qits-ci holds
 * nothing else about it. The project association lives in qits-projects and is a join performed in
 * the browser, so anything that wants to say "this repository belongs to *that* project" has to ask
 * for the project list and then for each project's repositories. That is `1 + P` requests, which is
 * why it is built **once per application instance** and shared: the tree pays it only to place a
 * deep link, and the run page pays it once no matter how many runs are opened afterwards.
 */
export interface Attribution {
  /** repoId → the project that claims it. A missing key is a repository no project claims. */
  readonly owners: ReadonlyMap<string, ProjectDto>;

  /** project id → its repositories, so a caller holding the index need not ask a second time. */
  readonly repositories: ReadonlyMap<string, readonly RepositoryDto[]>;
}

/**
 * The cached repository→project index.
 *
 * **A partial index is not published.** If one project's repository list fails, the whole build
 * fails and callers fall back to saying nothing about attribution — because the alternative, an
 * index missing one project's repositories, would report those repositories as "not claimed by any
 * project", which is a lie rather than a gap. Silence about a join is honest; a wrong join is not.
 */
@Injectable({ providedIn: 'root' })
export class RepositoryAttribution {
  private readonly api = inject(ProjectsApi);

  private index: Promise<Attribution> | null = null;

  /**
   * The index, built on the first call and re-used by every later one.
   *
   * `seed` is a courtesy from a caller that already holds the project list — the tree does — and not
   * an input that changes the answer: the first call wins and later seeds are ignored, because the
   * index is one shared object rather than a per-caller query.
   */
  attribution(seed?: readonly ProjectDto[]): Promise<Attribution> {
    return (this.index ??= this.build(seed));
  }

  /** Drop the index, so the next caller rebuilds it. The tree's Refresh button means this too. */
  forget(): void {
    this.index = null;
  }

  private async build(seed?: readonly ProjectDto[]): Promise<Attribution> {
    const projects = seed ?? (await this.api.projects());
    const lists = await Promise.all(projects.map((project) => this.api.repositories(project.id)));
    const owners = new Map<string, ProjectDto>();
    const repositories = new Map<string, readonly RepositoryDto[]>();
    projects.forEach((project, position) => {
      const list = lists[position] ?? [];
      repositories.set(project.id, list);
      for (const repository of list) {
        owners.set(repository.id, project);
      }
    });
    return { owners, repositories };
  }
}
