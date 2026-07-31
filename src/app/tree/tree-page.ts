import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { CiApi } from '../api/ci-api';
import type { ProjectDto, RepositoryDto } from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { repositoryLabel } from '../ui/format';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { RUN_PAGE_SIZE, RepoRuns, type RunsNode } from './repo-runs';
import { TreeNode } from './tree-node';

/** A node nobody has expanded yet: no request made, and that is a state rather than an absence. */
const UNVISITED: RunsNode = { state: IDLE, limited: false };

/** The comma-joined query parameter back as a set. */
function idSet(value: string | null): ReadonlySet<string> {
  return new Set((value ?? '').split(',').filter((id) => id.length > 0));
}

/** Add if missing, remove if present. */
function toggled(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

/** A map with one key replaced — the shape a signal of per-node state has to be updated in. */
function withEntry<T>(map: ReadonlyMap<string, T>, key: string, value: T): ReadonlyMap<string, T> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

/**
 * The tree: projects, their repositories, and each repository's runs grouped by what triggered
 * them — plus the bucket for CI activity no project claims.
 *
 * **Every level loads on expansion and caches once loaded.** Composing the whole tree eagerly would
 * cost `1 + P + R` requests before the first pixel, with every run list unbounded; the user's
 * clicks are the bound instead, so there is no fan-out budget to tune. On load this page makes
 * exactly two requests, and both are flat lists: the projects, and the repository ids qits-ci has
 * runs for.
 *
 * **The second of those is what makes the tree honest.** qits-ci keys a run by `repoId`, which is
 * the shared git-host directory name; a repository qits-projects provisioned has that name as its
 * `Repository.id`, but the platform's own repositories were seeded straight onto the git host with
 * no project row at all. A tree that only walked projects → repositories → runs would therefore
 * render, on this platform, as a list of projects with nothing under them while the entire run
 * history sat in a bucket it never drew. So the unattributed bucket is drawn *always*, including
 * when it is empty, because "0 repositories with no project" is information.
 *
 * Expansion lives in the query parameters and not in the path: it is view state, it is bookmarkable
 * there, and navigating with a history entry makes the back button mean "collapse", which is what
 * pressing back on a tree should do. Reading expansion back out of the URL is also what makes the
 * back button *work* — the effect below loads whatever the URL says is open, so a restored
 * expansion fetches exactly the nodes it needs and no others.
 */
@Component({
  selector: 'app-tree-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton, RepoRuns, TreeNode],
  templateUrl: './tree-page.html',
  styleUrl: './tree-page.css',
})
export class TreePage {
  private readonly projectsApi = inject(ProjectsApi);
  private readonly ciApi = inject(CiApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly repositoryLabel = repositoryLabel;

  /** The project spine. Its failure is the only one that can take the whole page down. */
  protected readonly projects = signal<Loadable<readonly ProjectDto[]>>(LOADING);

  /** Every repository id qits-ci holds runs for — the bucket's own source of truth. */
  protected readonly repositoryIds = signal<Loadable<readonly string[]>>(LOADING);

  /** Per project, its repositories. A missing key is a project nobody has expanded. */
  protected readonly repositories = signal<ReadonlyMap<string, Loadable<readonly RepositoryDto[]>>>(
    new Map(),
  );

  /** Per repository id, its runs. Keyed by `Repository.id`, which is qits-ci's `repoId`. */
  protected readonly runs = signal<ReadonlyMap<string, RunsNode>>(new Map());

  /**
   * The unattributed bucket starts open, and it is the one node that does. Expanding it costs no
   * request — the ids arrived with the page — and on this platform it is where the run history
   * actually is, so opening it by default shows the data rather than hiding it behind a click.
   */
  protected readonly bucketOpen = signal(true);

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly expandedProjects = computed(() => idSet(this.queryParams().get('project')));
  protected readonly expandedRepos = computed(() => idSet(this.queryParams().get('repo')));

  /** The projects, once they are here; an empty list otherwise, so the template stays flat. */
  protected readonly projectList = computed(() => {
    const state = this.projects();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * Both roots failed, which is the one unrecoverable state: with neither the projects nor the
   * repository ids there is no tree to draw around the gap.
   */
  protected readonly unrecoverable = computed(
    () => this.projects().kind === 'error' && this.repositoryIds().kind === 'error',
  );

  /** Projects are down but qits-ci answered: the bucket alone, behind a banner that says why. */
  protected readonly projectsBanner = computed(() => {
    const state = this.projects();
    return state.kind === 'error' && !this.unrecoverable() ? state.message : '';
  });

  /** Whatever went wrong at the root, for the full-page error. */
  protected readonly rootError = computed(() => {
    const state = this.projects();
    return state.kind === 'error' ? state.message : '';
  });

  /**
   * Every repository id claimed by a project that has been expanded. It is computed against the
   * projects **already opened**, because that is all the client has asked about — so a repository
   * that turns out to belong to a project leaves the bucket the moment that project expands, which
   * is correct and visible.
   */
  private readonly claimed = computed(() => {
    const claimed = new Set<string>();
    for (const state of this.repositories().values()) {
      if (state.kind === 'ready') {
        for (const repository of state.value) {
          claimed.add(repository.id);
        }
      }
    }
    return claimed;
  });

  /** The bucket's rows: what qits-ci has runs for, minus what an expanded project claims. */
  protected readonly unclaimed = computed(() => {
    const ids = this.repositoryIds();
    return ids.kind === 'ready' ? ids.value.filter((id) => !this.claimed().has(id)) : [];
  });

  /** How many repositories qits-ci has runs for at all — honest before any project is opened. */
  protected readonly knownRepositoryCount = computed(() => {
    const ids = this.repositoryIds();
    return ids.kind === 'ready' ? ids.value.length : 0;
  });

  protected readonly summary = computed(() => {
    const projects = this.projectList().length;
    const orphans = this.unclaimed().length;
    return (
      `${projects} ${projects === 1 ? 'project' : 'projects'} · ` +
      `${orphans} ${orphans === 1 ? 'repository' : 'repositories'} with no project.`
    );
  });

  constructor() {
    void this.reload();

    // What the URL says is open, is open — on first load, on a deep link, and on the back button.
    // Guarded by the node's own presence in the map rather than by a flag: a load writes `loading`
    // synchronously before it awaits, so the key exists by the time this effect could run again.
    effect(() => {
      for (const projectId of this.expandedProjects()) {
        if (!this.repositories().has(projectId)) {
          void this.loadRepositories(projectId);
        }
      }
      for (const repoId of this.expandedRepos()) {
        if (!this.runs().has(repoId)) {
          void this.loadRuns(repoId);
        }
      }
    });
  }

  /** The one button on this page: drop every cache and read the two roots again. */
  protected async reload(): Promise<void> {
    this.repositories.set(new Map());
    this.runs.set(new Map());
    await Promise.all([this.loadProjects(), this.loadRepositoryIds()]);
  }

  protected async loadProjects(): Promise<void> {
    this.projects.set(LOADING);
    try {
      this.projects.set(ready(await this.projectsApi.projects()));
    } catch (error) {
      this.projects.set(failed(error));
    }
  }

  protected async loadRepositoryIds(): Promise<void> {
    this.repositoryIds.set(LOADING);
    try {
      this.repositoryIds.set(ready(await this.ciApi.repositoryIds()));
    } catch (error) {
      this.repositoryIds.set(failed(error));
    }
  }

  protected async loadRepositories(projectId: string): Promise<void> {
    this.repositories.update((map) => withEntry(map, projectId, LOADING));
    try {
      const repositories = await this.projectsApi.repositories(projectId);
      this.repositories.update((map) => withEntry(map, projectId, ready(repositories)));
    } catch (error) {
      this.repositories.update((map) => withEntry(map, projectId, failed(error)));
    }
  }

  /** The newest hundred. A failure here collapses to a retry on this row and nowhere else. */
  protected loadRuns(repoId: string): Promise<void> {
    return this.fetchRuns(repoId, RUN_PAGE_SIZE);
  }

  /** The same list without the limit, once the first answer came back full. */
  protected loadAllRuns(repoId: string): Promise<void> {
    return this.fetchRuns(repoId, undefined);
  }

  private async fetchRuns(repoId: string, limit: number | undefined): Promise<void> {
    this.runs.update((map) => withEntry(map, repoId, { state: LOADING, limited: false }));
    try {
      const runs = await this.ciApi.runs(repoId, limit);
      // "Full" is the only signal there is that more exist: the listing carries no total.
      const limited = limit !== undefined && runs.length >= limit;
      this.runs.update((map) => withEntry(map, repoId, { state: ready(runs), limited }));
    } catch (error) {
      this.runs.update((map) => withEntry(map, repoId, { state: failed(error), limited: false }));
    }
  }

  protected repositoriesOf(projectId: string): Loadable<readonly RepositoryDto[]> {
    return this.repositories().get(projectId) ?? IDLE;
  }

  protected runsOf(repoId: string): RunsNode {
    return this.runs().get(repoId) ?? UNVISITED;
  }

  /** `6 repositories`, once they are known; nothing before the project has been opened. */
  protected projectMeta(projectId: string): string {
    const state = this.repositoriesOf(projectId);
    if (state.kind !== 'ready') {
      return '';
    }
    return `${state.value.length} ${state.value.length === 1 ? 'repository' : 'repositories'}`;
  }

  protected toggleBucket(): void {
    this.bucketOpen.update((open) => !open);
  }

  protected toggleProject(projectId: string): void {
    this.navigate('project', toggled(this.expandedProjects(), projectId));
  }

  protected toggleRepository(repoId: string): void {
    this.navigate('repo', toggled(this.expandedRepos(), repoId));
  }

  /**
   * A history entry on purpose, not `replaceUrl`: back should collapse what forward expanded.
   * `merge` keeps the other level's parameter, and an empty set is written as null so the parameter
   * disappears rather than lingering as `?project=`.
   */
  private navigate(key: 'project' | 'repo', ids: ReadonlySet<string>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: ids.size > 0 ? [...ids].join(',') : null },
      queryParamsHandling: 'merge',
    });
  }
}
