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
import { QitsBadge, QitsButton } from '@qits/ui-components';
import { RepositoryAttribution, type Attribution } from '../api/attribution';
import { CiApi } from '../api/ci-api';
import type { CiRepositorySummaryDto, CiRunDto, ProjectDto, RepositoryDto } from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { formatDayTime, named, repositoryLabel, shortSha } from '../ui/format';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { ActiveRuns } from './active-runs';
import { RUN_PAGE_SIZE, RepoRuns, type RunsNode } from './repo-runs';
import { TreeNode } from './tree-node';

/** A node nobody has expanded yet: no request made, and that is a state rather than an absence. */
const UNVISITED: RunsNode = { state: IDLE, limited: false };

/**
 * What the `?project=` parameter says when the answer is "none of them".
 *
 * Projects are open by default, so an *absent* parameter cannot mean "nothing is expanded" — it
 * already means "everything is". Collapsing the last one therefore has to write something, and an
 * empty value is the honest something: it is present, so the default does not apply, and it names
 * no project, which is exactly the state it records.
 */
const NONE_EXPANDED = '';

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
 * **The levels that cost a request per node still load on expansion.** Composing the whole tree
 * eagerly would cost `1 + P + R` requests before the first pixel, with every run list unbounded and
 * every run list a different repository's; the user's clicks are the bound on those, so there is no
 * fan-out budget to tune below a repository row.
 *
 * **On load this page reads `5 + P`**, and every one of those is a flat list:
 *
 * - `GET /projects/api/projects` — the spine.
 * - `GET /ci/api/repositories` — the ids qits-ci has runs for, which is what the bucket counts.
 * - `GET /ci/api/repositories/summary` — one headline pair per repository, for the row badges.
 * - `GET /ci/api/runs/active` — the right rail's first read.
 * - `GET /ci/api/runs/finished` — the other half of the rail, seeding its stack of what is over.
 * - `GET /projects/api/projects/{id}/repositories`, once per project — the attribution index.
 *
 * The two rail reads are the only ones that repeat, and they repeat together: the rail asks both on
 * one ten-second tick, which is what lets it watch a run cross from one list to the other without
 * reading that run individually.
 *
 * That last line is the deliberate amendment to Decision 3's budget, and it is bought with
 * correctness that could not be had any other way. Attribution used to be built only when a deep
 * link needed it, so until the first project was expanded *every* repository sat under "Not claimed
 * by any project" — a screen that was wrong about the one thing this tree exists to report. The
 * index is what makes the bucket right from the first paint, it is cached for the whole application
 * so the run page never pays for it again, and the P requests it costs are the same P requests the
 * old design paid the moment anybody opened the projects. Expanding a project is now free.
 *
 * **The second of those is what makes the tree honest.** qits-ci keys a run by `repoId`, the git
 * host's opaque storage key; a repository qits-projects provisioned has that key as its
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
 *
 * **Projects start open**, and only projects. Their repositories have already arrived, so drawing
 * them costs nothing and hiding them behind a click hid the tree's whole first level behind one; the
 * levels below stay shut because each of those *is* a request. An explicit `?project=` still wins
 * outright — that is what keeps an expansion shareable, and what a link from the run page relies on.
 */
@Component({
  selector: 'app-tree-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActiveRuns, Async, Empty, QitsBadge, QitsButton, RepoRuns, StatusBadge, TreeNode],
  templateUrl: './tree-page.html',
  styleUrl: './tree-page.css',
})
export class TreePage {
  private readonly projectsApi = inject(ProjectsApi);
  private readonly ciApi = inject(CiApi);
  private readonly attribution = inject(RepositoryAttribution);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly repositoryLabel = repositoryLabel;

  /** The project spine. Its failure is the only one that can take the whole page down. */
  protected readonly projects = signal<Loadable<readonly ProjectDto[]>>(LOADING);

  /** Every repository id qits-ci holds runs for — the bucket's own source of truth. */
  protected readonly repositoryIds = signal<Loadable<readonly string[]>>(LOADING);

  /**
   * The attribution index, loaded up front rather than on demand. Its state is what tells the
   * repository rows apart from a tree that simply has not finished loading yet.
   */
  protected readonly index = signal<Loadable<Attribution>>(LOADING);

  /**
   * Per project, its repositories — filled in one pass from the index, not one project at a time.
   * A key can still hold an error: when the index fails, every project row carries that failure and
   * offers its own retry, which is the only lazy path left on this level.
   */
  protected readonly repositories = signal<ReadonlyMap<string, Loadable<readonly RepositoryDto[]>>>(
    new Map(),
  );

  /**
   * Per repository id, its last run and its last main-branch run — the two badges on a row.
   *
   * There is no error state and no retry, deliberately. These badges annotate rows that are drawn
   * and navigable without them, so a summary that did not arrive draws nothing; an inline warning on
   * every repository in the tree would be far louder than what it reports, and a placeholder badge
   * would be an invented status. Silence about an annotation is honest.
   */
  protected readonly summaries = signal<ReadonlyMap<string, CiRepositorySummaryDto>>(new Map());

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

  /**
   * The `?repo=` ids this page was *entered* with, as opposed to the ones a click opened.
   *
   * Only these are looked up. A repository the user expanded by clicking is already on screen under
   * whatever claims it, so there is nothing to place; a repository that arrived in the URL — from
   * the run page's link, a bookmark, or a pasted address — may belong to a project nothing has
   * opened, and without the lookup it would sit in the unattributed bucket beside a header wrongly
   * counting it as unclaimed. That is exactly what the bare `?repo=` link produced live.
   */
  private readonly entryRepos = idSet(this.route.snapshot.queryParamMap.get('repo'));

  /** Repository ids already put through the lookup, so it happens at most once for each. */
  private readonly placed = new Set<string>();

  /** The projects, once they are here; an empty list otherwise, so the template stays flat. */
  protected readonly projectList = computed(() => {
    const state = this.projects();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * Which projects are drawn open. An absent parameter means all of them; a present one — including
   * an empty one — means exactly what it names, so a shared URL survives being shared.
   */
  protected readonly expandedProjects = computed<ReadonlySet<string>>(() => {
    const param = this.queryParams().get('project');
    return param === null ? new Set(this.projectList().map((project) => project.id)) : idSet(param);
  });

  protected readonly expandedRepos = computed(() => idSet(this.queryParams().get('repo')));

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
   * Every repository id some project claims.
   *
   * This used to be computed against the projects already *opened*, so a repository moved out of the
   * unattributed bucket only when somebody expanded the project that owned it — which meant that on
   * arrival the tree reported every repository on the platform as claimed by nobody. The index makes
   * it complete from the first paint instead, and the bucket finally means what its label says.
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

  /** The bucket's rows: what qits-ci has runs for, minus what any project claims. */
  protected readonly unclaimed = computed(() => {
    const ids = this.repositoryIds();
    return ids.kind === 'ready' ? ids.value.filter((id) => !this.claimed().has(id)) : [];
  });

  /**
   * How many repositories qits-ci has runs for at all. It is qits-ci's own count and not the
   * bucket's, so the header stays true whatever qits-projects turns out to claim — including when
   * the index never arrived and nothing can be attributed.
   */
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
    // Only the run level is left to load here: the repositories of every project arrived with the
    // index. Guarded by the node's own presence in the map rather than by a flag, because a load
    // writes `loading` synchronously before it awaits.
    effect(() => {
      for (const repoId of this.expandedRepos()) {
        if (!this.runs().has(repoId)) {
          void this.loadRuns(repoId);
        }
      }
    });

    // A repository named by a URL that also pinned the projects, but not the project that owns it.
    // Nothing to do in the ordinary case — with no `?project=` every project is open and the
    // repository is already on screen under its owner — so this runs only for an address that
    // narrowed the tree past the thing it was pointing at.
    effect(() => {
      const index = this.index();
      if (index.kind !== 'ready' || this.queryParams().get('project') === null) {
        return;
      }
      for (const repoId of this.entryRepos) {
        if (!this.placed.has(repoId)) {
          this.placed.add(repoId);
          this.place(repoId, index.value);
        }
      }
    });
  }

  /**
   * Open the project that claims a repository, so a pinned URL still shows what it pointed at.
   *
   * The URL is *replaced* rather than pushed: this is the page repairing an address, not the user
   * expanding a node, and back should return to wherever they came from rather than stepping through
   * a correction they never made. A repository the index does not name is genuinely unattributed,
   * and it stays in the bucket where it belongs.
   */
  private place(repoId: string, index: Attribution): void {
    const owner = index.owners.get(repoId);
    if (!owner || this.expandedProjects().has(owner.id)) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { project: [...toggled(this.expandedProjects(), owner.id)].join(',') },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** The one button on this page: drop every cache and read the tree's roots again. */
  protected async reload(): Promise<void> {
    this.repositories.set(new Map());
    this.runs.set(new Map());
    this.placed.clear();
    this.attribution.forget();
    await Promise.all([this.loadProjects(), this.loadRepositoryIds(), this.loadSummaries()]);
  }

  /**
   * The spine, and then the index built on top of it. The two are one operation from the page's
   * point of view: without the second the first cannot say which repository belongs where, and a
   * tree that draws its projects before it knows that is a tree that is briefly wrong.
   */
  protected async loadProjects(): Promise<void> {
    this.projects.set(LOADING);
    this.index.set(LOADING);
    try {
      const projects = await this.projectsApi.projects();
      this.projects.set(ready(projects));
      await this.loadIndex(projects);
    } catch (error) {
      this.projects.set(failed(error));
      this.index.set(failed(error));
    }
  }

  /**
   * Ask every project for its repositories, once, and hand the answers to every row at the same
   * time.
   *
   * The index is all-or-nothing by design — a partial one would report the missing project's
   * repositories as claimed by nobody, which is a lie rather than a gap — so a failure here writes
   * the *same* failure onto every project row. Each then offers its own retry, which is the one
   * remaining path that loads a single project's repositories on its own.
   */
  private async loadIndex(projects: readonly ProjectDto[]): Promise<void> {
    this.index.set(LOADING);
    try {
      const index = await this.attribution.attribution(projects);
      this.index.set(ready(index));
      this.repositories.set(
        new Map(
          projects.map((project) => [project.id, ready(index.repositories.get(project.id) ?? [])]),
        ),
      );
    } catch (error) {
      this.index.set(failed(error));
      this.repositories.set(new Map(projects.map((project) => [project.id, failed(error)])));
    }
  }

  /**
   * The row badges. Read on load, and again only when the active column reports the platform's work
   * in flight has changed — which is the one moment some repository's newest run became a different
   * run. Refreshing on a timer of its own would re-read every repository on a platform where
   * nothing had happened; refreshing on the active list means an idle platform pays nothing and a
   * busy one is right within a poll.
   */
  protected async loadSummaries(): Promise<void> {
    try {
      const summaries = await this.ciApi.repositorySummaries();
      this.summaries.set(new Map(summaries.map((entry) => [entry.repositoryId, entry])));
    } catch {
      // Annotations, not content. The last good badges stay, and a first read that never arrived
      // leaves the rows bare rather than putting an error on every one of them.
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

  /**
   * A project's repositories. While the index is still in flight every open project reads as
   * *loading* rather than as never-asked: the request that will answer it is already out, and an
   * idle node draws nothing at all, which for a first level that is open by default would be a
   * screenful of blank rows in the window before the index lands.
   */
  protected repositoriesOf(projectId: string): Loadable<readonly RepositoryDto[]> {
    const known = this.repositories().get(projectId);
    if (known) {
      return known;
    }
    return this.index().kind === 'loading' ? LOADING : IDLE;
  }

  protected runsOf(repoId: string): RunsNode {
    return this.runs().get(repoId) ?? UNVISITED;
  }

  /** The two headline runs for a row, or undefined for a repository qits-ci has no runs for. */
  protected summaryOf(repoId: string): CiRepositorySummaryDto | undefined {
    return this.summaries().get(repoId);
  }

  /**
   * The label for a bucket row, which has no repository record behind it to take a name from.
   *
   * The bucket is drawn from `GET /ci/api/repositories` — bare storage ids, no names — so the name
   * comes from the summary the same id has, which qits-ci reads off that repository's newest run.
   * No summary, or a run that announced no name, and the storage id is the label: there is nothing
   * else true to draw. The key is the id in every case, which is why this is a label function and
   * not a rename of `repoId`.
   */
  protected bucketLabel(repoId: string): string {
    return named(this.summaries().get(repoId)?.repoName) ?? repoId;
  }

  /**
   * `main 9f96484 · 31 Jul 14:06` — what the main branch last built, and when.
   *
   * The day is on the badge and not only the clock. A bare `19:12` reads as *tonight* whatever it
   * means, and the badge whose whole job is telling an operator how stale a repository's main branch
   * is would then be at its most misleading exactly when the answer is "days ago". The branch name
   * is the run's own rather than the word "main", because a repository whose main branch is called
   * something else deserves to be told the truth about it. The instant is the build's finish, or its
   * start for one still going — UTC, like every other timestamp this client draws.
   */
  protected mainLabel(run: CiRunDto): string {
    return `${run.branch} ${shortSha(run.commitSha)} · ${formatDayTime(run.finishedAt ?? run.createdAt)}`;
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
   * `merge` keeps the other level's parameter.
   *
   * The two levels differ on what "nothing" looks like, and they have to. Repositories are closed by
   * default, so an absent `?repo=` already says nothing is open and the parameter is dropped.
   * Projects are open by default, so dropping `?project=` would re-open every one of them — the
   * empty value is written instead, and it is the difference between "I have not said" and "I said
   * none".
   */
  private navigate(key: 'project' | 'repo', ids: ReadonlySet<string>): void {
    const empty = key === 'project' ? NONE_EXPANDED : null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: ids.size > 0 ? [...ids].join(',') : empty },
      queryParamsHandling: 'merge',
    });
  }
}
