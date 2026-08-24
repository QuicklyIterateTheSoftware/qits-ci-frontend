import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsScope } from '@qits/ui-components';
import { routes } from '../app.routes';
import type { CiRepositorySummaryDto, CiRunDto, ProjectDto, RepositoryDto } from '../api/dto';

/**
 * The states table, one `it` at a time, driven through `HttpTestingController`.
 *
 * The assertion that matters most is still a negative one — that a repository nobody expanded costs
 * **no** run list — because that is the level where the fan-out would actually hurt and it is silent
 * when it regresses: an eager tree looks identical on screen and simply costs a request per
 * repository.
 *
 * The budget above that level is now deliberately larger, and it is asserted rather than assumed.
 * On load this page reads `5 + P`: the projects, the repository ids qits-ci has runs for, the
 * repository summaries, the rail's two listings — what is in flight and what has just finished —
 * and one repository list per project. The last of
 * those is the attribution index, and it is what buys the thing the old lazier tree got wrong —
 * every repository sat under "Not claimed by any project" until somebody expanded the project that
 * owned it, which is a wrong answer to the question this screen exists to answer.
 */
describe('TreePage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const project = (id: string, name: string): ProjectDto => ({
    id,
    name,
    slug: name,
    description: null,
    dns: null,
  });

  const repository = (id: string, projectId: string): RepositoryDto => ({
    id,
    name: id,
    backupUrl: `https://example.test/QuicklyIterate/${id}.git`,
    mainBranch: 'main',
    archetype: 'SERVICE',
    projectId,
  });

  const run = (id: string, over: Partial<CiRunDto> = {}): CiRunDto => ({
    id,
    repoId: 'qits-ci',
    projectId: null,
    repoName: null,
    branch: 'main',
    commitSha: '9f2c1ab3d4e5',
    status: 'SUCCESS',
    createdAt: '2026-07-31T14:02:11Z',
    startedAt: '2026-07-31T14:02:12Z',
    finishedAt: '2026-07-31T14:06:23Z',
    cancellationReason: null,
    supersededByRunId: null,
    daemonVersion: '0.4.1',
    triggerType: 'POST_RECEIVE',
    triggerEventId: null,
    triggerEventName: null,
    configPath: '.config/qits/ci-post-receive.yml',
    steps: null,
    live: null,
    ...over,
  });

  /**
   * A summary row, keyed by the storage id. `projectId` and `repoName` default to absent, which is
   * what qits-ci answers for a repository whose newest run announced no public address.
   */
  const summary = (
    repositoryId: string,
    over: Partial<CiRepositorySummaryDto> = {},
  ): CiRepositorySummaryDto => ({
    repositoryId,
    projectId: null,
    repoName: null,
    lastRun: null,
    lastMainRun: null,
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The pages read what the address says is in scope; with no project list behind it this
        // resolves to nothing, which is the unscoped tree these specs are about.
        provideQitsScope('repository'),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** Mount the tree at a URL. Doing it per test is what lets a deep link be one of them. */
  async function open(url = '/'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function labels(selector: string): (string | null)[] {
    return Array.from(page().querySelectorAll(selector)).map((node) => node.textContent);
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(page().querySelectorAll('button'));
  }

  async function click(label: string): Promise<void> {
    const target = buttons().find((button) => (button.textContent ?? '').includes(label));
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  /**
   * Let the flushed responses land, their signals write, and change detection run.
   *
   * The rounds drain microtasks as well as waiting for stability: the attribution index is a promise
   * chain several links long, and an app that is *stable* is not the same as one whose promises have
   * all settled.
   */
  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function flushProjects(projects: readonly ProjectDto[]): void {
    http
      .expectOne('/projects/api/projects')
      .flush({ entries: projects.map((entry) => ({ project: entry })) });
  }

  function flushRepositoryIds(repositoryIds: readonly string[]): void {
    http.expectOne('/ci/api/repositories').flush({ repositoryIds });
  }

  function flushSummaries(summaries: readonly CiRepositorySummaryDto[] = []): void {
    http.expectOne('/ci/api/repositories/summary').flush({ repositories: summaries });
  }

  /**
   * The rail's pair of reads. It asks both listings on every tick — what is in flight, and what has
   * just finished — so answering only the first would leave a request open that `http.verify()`
   * reports. The finished stack is the rail's own business; this page only has to let it load.
   */
  function flushActive(runs: readonly CiRunDto[] = []): void {
    http.expectOne('/ci/api/runs/active').flush({ runs });
    http.expectOne((request) => request.url === '/ci/api/runs/finished').flush({ runs: [] });
  }

  function flushRepositories(projectId: string, repositories: readonly RepositoryDto[]): void {
    http
      .expectOne(`/projects/api/projects/${projectId}/repositories`)
      .flush({ entries: repositories.map((entry) => ({ repository: entry })) });
  }

  /**
   * Answer everything the page asks for on load: the five flat reads, and then the attribution
   * index's one repository list per project. `claims` maps a project id to the repositories it owns
   * and defaults to none, which is the platform's own shape before anything is onboarded.
   */
  async function flushRoots(
    projects: readonly ProjectDto[],
    repositoryIds: readonly string[],
    claims: Readonly<Record<string, readonly RepositoryDto[]>> = {},
    summaries: readonly CiRepositorySummaryDto[] = [],
  ): Promise<void> {
    flushProjects(projects);
    flushRepositoryIds(repositoryIds);
    flushSummaries(summaries);
    flushActive();
    await settle();
    for (const entry of projects) {
      flushRepositories(entry.id, claims[entry.id] ?? []);
    }
    await settle();
  }

  function expectRuns(repoId: string) {
    return http.expectOne(
      (request) => request.url === '/ci/api/runs' && request.params.get('repositoryId') === repoId,
    );
  }

  it('reads four flat lists and one repository list per project, and no run list at all', async () => {
    await open();
    flushProjects([project('p1', 'qits'), project('p2', 'website')]);
    flushRepositoryIds(['qits-ci']);
    flushSummaries();
    flushActive();
    await settle();

    // The index: exactly one request per project, and it is what makes the bucket right on arrival.
    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    flushRepositories('p2', []);
    await settle();

    expect(text()).toContain('qits');
    expect(text()).toContain('2 projects');
    // No run list: below a repository row, the user's clicks are still the bound.
    http.verify();
  });

  /**
   * The whole reason the index moved to load time. This used to read "3 repositories with no
   * project" and list every repository on the platform in the bucket, until a click said otherwise.
   */
  it('attributes every repository before the first click, not after the first expansion', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], ['qits-ci', 'legacy-build-box'], {
      p1: [repository('qits-ci', 'p1')],
    });

    expect(text()).toContain('1 repository with no project.');
    expect(labels('.bucket .label')).toContain('legacy-build-box');
    expect(labels('.bucket .label')).not.toContain('qits-ci');
    // The count stays qits-ci's own, so it is honest about what has CI activity either way.
    expect(text()).toContain('2 repositories with CI runs');
  });

  it('opens every project on load and draws its repositories without a further request', async () => {
    await open();
    await flushRoots([project('p1', 'qits'), project('p2', 'website')], [], {
      p1: [repository('qits-ci', 'p1')],
      p2: [repository('qits-www', 'p2')],
    });

    // Both projects open, both their repositories on screen, nothing else asked for.
    expect(text()).toContain('qits-ci');
    expect(text()).toContain('qits-www');
    expect(text()).toContain('1 repository');
    http.verify();
  });

  it('leaves the levels below a project shut, because each of those is a request', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], [], { p1: [repository('qits-ci', 'p1')] });

    http.verify(); // the repository is visible and has been asked nothing

    await click('qits-ci');
    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();
    expect(text()).toContain('r1');
  });

  it('collapses a failed index onto every project row, and retries one of them in place', async () => {
    await open();
    flushProjects([project('p1', 'qits'), project('p2', 'website')]);
    flushRepositoryIds([]);
    flushSummaries();
    flushActive();
    await settle();

    // The index is all-or-nothing: a partial one would report the missing project's repositories as
    // claimed by nobody, so one failure is reported on every row rather than hidden on one.
    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    http
      .expectOne('/projects/api/projects/p2/repositories')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Could not load repositories — 503');
    // The rest of the tree is standing and still clickable.
    expect(buttons().some((button) => (button.textContent ?? '').includes('website'))).toBe(true);

    await click('Retry');
    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    await settle();
    expect(text()).toContain('qits-ci');
  });

  it('says so when a project has no repositories', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], [], { p1: [] });

    expect(text()).toContain('This project has no repositories.');
  });

  it('says so when qits-ci has never seen a repository — an empty list, not a 404', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], [], { p1: [repository('qits-docs', 'p1')] });

    await click('qits-docs');
    expectRuns('qits-docs').flush({ runs: [] });
    await settle();

    expect(text()).toContain('No runs recorded for this repository.');
  });

  it('collapses a failed run fetch to a retry on that row, and retries it in place', async () => {
    await open();
    await flushRoots([], ['qits-ci']);

    await click('qits-ci');
    expectRuns('qits-ci').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(text()).toContain('Could not load runs — 503');

    await click('Retry');
    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();

    expect(text()).not.toContain('Could not load runs');
    expect(text()).toContain('r1');
  });

  it('groups runs by trigger type without a further request, in enum order', async () => {
    await open();
    await flushRoots([], ['qits-ci']);

    await click('qits-ci');
    expectRuns('qits-ci').flush({
      runs: [
        run('r1'),
        run('r2', {
          triggerType: 'EVENT',
          triggerEventName: 'BuildSuccessful',
          configPath: '.config/qits/ci-event-upstream-ui-components.yml',
        }),
      ],
    });
    await settle();

    const groups = labels('.label');
    expect(groups).toContain('POST_RECEIVE');
    expect(groups).toContain('EVENT');
    expect(groups.indexOf('POST_RECEIVE')).toBeLessThan(groups.indexOf('EVENT'));
    expect(text()).toContain('BuildSuccessful');
    // Expanding a group is a client-side groupBy over a list that has already arrived.
    http.verify();
  });

  it('offers “show all” only when the answer came back full, and drops the limit for it', async () => {
    await open();
    await flushRoots([], ['qits-ci']);

    await click('qits-ci');
    expectRuns('qits-ci').flush({ runs: Array.from({ length: 100 }, (_, i) => run(`r${i}`)) });
    await settle();

    expect(text()).toContain('newest 100 shown');

    await click('show all runs');
    const unbounded = expectRuns('qits-ci');
    expect(unbounded.request.params.has('limit')).toBe(false);
    unbounded.flush({ runs: [run('r0')] });
    await settle();

    expect(text()).not.toContain('newest 100 shown');
  });

  /**
   * The bucket is drawn from bare storage ids, so its only source of a name is the summary the same
   * id carries — which qits-ci reads off that repository's newest run. Without one there is nothing
   * true to draw but the id.
   */
  it('labels a bucket row by the name its newest run announced, and by its id otherwise', async () => {
    const named = '3f6c1a9e-0b25-4d1e-9c77-2a0e5b8f4d31';
    const nameless = 'c1a70f38-9d64-4b02-8e5a-6f3d18b7c920';
    await open();
    await flushRoots([], [named, nameless], {}, [
      summary(named, { repoName: 'qits-ci', projectId: 'p1', lastRun: run('r1') }),
      summary(nameless, { lastRun: run('r2') }),
    ]);

    const rows = labels('.bucket .label');
    expect(rows).toContain('qits-ci');
    expect(rows).toContain(nameless);
    expect(rows).not.toContain(named);
  });

  /** The label moved; the key did not. Expanding a named row still asks by the storage id. */
  it('keys a bucket row by the storage id even when it draws a name', async () => {
    const id = '3f6c1a9e-0b25-4d1e-9c77-2a0e5b8f4d31';
    await open();
    await flushRoots([], [id], {}, [summary(id, { repoName: 'qits-ci', lastRun: run('r1') })]);

    await click('qits-ci');
    expectRuns(id).flush({ runs: [run('r1')] });
    await settle();
  });

  it('draws the unattributed bucket always — “0 repositories” is information', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], []);

    expect(text()).toContain('Not claimed by any project');
    expect(text()).toContain('0 repositories with CI runs');
    expect(text()).toContain('Every repository with CI runs is claimed by a project.');
  });

  /**
   * The two badges behind a repository name: what it last did, and what its main branch last built.
   * Both are annotations on a row that works without them, which is why the third case below draws
   * nothing at all rather than a placeholder.
   */
  it('shows a repository’s last run and its main branch’s last build behind its name', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], [], { p1: [repository('qits-ci', 'p1')] }, [
      summary('qits-ci', {
        lastRun: run('r2', { branch: 'topic', status: 'FAILED' }),
        lastMainRun: run('r1', { commitSha: '9f964840ab', finishedAt: '2026-07-31T19:12:04Z' }),
      }),
    ]);

    const badges = labels('.badges qits-badge');
    expect(badges.some((label) => label?.includes('FAILED'))).toBe(true);
    expect(badges.some((label) => label?.includes('main 9f96484 · 31 Jul 19:12'))).toBe(true);
  });

  it('draws no badges at all for a repository qits-ci has no runs for', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], [], { p1: [repository('qits-docs', 'p1')] });

    expect(labels('.badges qits-badge')).toEqual([]);
  });

  it('badges a repository in the unattributed bucket too — the rows are the same rows', async () => {
    await open();
    await flushRoots([], ['legacy-build-box'], {}, [
      summary('legacy-build-box', { lastRun: run('r1') }),
    ]);

    expect(labels('.bucket .badges qits-badge').some((l) => l?.includes('SUCCESS'))).toBe(true);
  });

  /**
   * The tree does not poll and the summaries do not refresh on a timer. What refreshes them is the
   * right rail noticing that the set of runs in flight is a different set — which is the one moment
   * some repository's newest run became a different run.
   */
  it('re-reads the summaries when the active list changes, and not when it merely repeats', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await open();
      await flushRoots([], ['qits-ci'], {}, [summary('qits-ci', { lastRun: run('r1') })]);

      vi.advanceTimersByTime(10_000);
      await settle();
      flushActive([run('r9', { status: 'RUNNING' })]);
      await settle();
      // A run appeared, so the repository's newest run is a different run.
      flushSummaries([summary('qits-ci', { lastRun: run('r9', { status: 'RUNNING' }) })]);
      await settle();
      expect(labels('.badges qits-badge').some((l) => l?.includes('RUNNING'))).toBe(true);

      vi.advanceTimersByTime(10_000);
      await settle();
      flushActive([run('r9', { status: 'RUNNING' })]);
      await settle();
      // The same run is still the same run; nothing anybody caches has changed.
      http.verify();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a full-page error only when both roots fail', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 500, statusText: 'Error' });
    http.expectOne('/ci/api/repositories').flush(null, { status: 500, statusText: 'Error' });
    flushSummaries();
    flushActive();
    await settle();

    expect(text()).toContain('Could not load the tree');
    // Projects never answered, so there was nothing to build an index over.
    http.verify();

    await click('Retry');
    flushProjects([]);
    flushRepositoryIds([]);
    flushSummaries();
    await settle();

    expect(text()).not.toContain('Could not load the tree');
    // The rail lives outside the error, so a root failure never tore it down or restarted its poll.
    http.verify();
  });

  it('renders the bucket alone behind a banner when projects are down but qits-ci is not', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    flushRepositoryIds(['qits-ci']);
    flushSummaries();
    flushActive();
    await settle();

    expect(text()).toContain('Projects are unavailable');
    expect(text()).not.toContain('Could not load the tree');
    expect(labels('.bucket .label')).toContain('qits-ci');
  });

  it('keeps the tree standing when qits-ci is down and projects are not', async () => {
    await open();
    flushProjects([project('p1', 'qits')]);
    http.expectOne('/ci/api/repositories').flush(null, { status: 503, statusText: 'Down' });
    http.expectOne('/ci/api/repositories/summary').flush(null, { status: 503, statusText: 'Down' });
    http.expectOne('/ci/api/runs/active').flush(null, { status: 503, statusText: 'Down' });
    http
      .expectOne((request) => request.url === '/ci/api/runs/finished')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();
    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    await settle();

    expect(text()).toContain('qits');
    expect(text()).toContain('Could not load the repositories qits-ci knows — 503');
    // A summary that never arrived draws no badges rather than an error on every row.
    expect(labels('.badges qits-badge')).toEqual([]);

    await click('qits-ci');
    expectRuns('qits-ci').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Could not load runs — 503');
  });

  /**
   * Projects are open by default, so the URL has to be able to say "none" as well as "these" —
   * an absent parameter already means "all of them", and dropping it on the last collapse would
   * re-open everything.
   */
  it('starts every project open and writes the survivors into the URL when one collapses', async () => {
    await open();
    await flushRoots([project('p1', 'qits'), project('p2', 'website')], [], {
      p1: [repository('qits-ci', 'p1')],
      p2: [],
    });

    const router = TestBed.inject(Router);
    expect(router.url).not.toContain('project=');
    expect(text()).toContain('qits-ci');

    await click('qits');
    expect(router.url).toContain('project=p2');
    expect(text()).not.toContain('qits-ci');

    await click('website');
    expect(router.url).toContain('project=');
    expect(router.url).not.toContain('project=p2');

    // Back collapses what forward expanded — and, here, the other way round.
    await click('website');
    expect(router.url).toContain('project=p2');
  });

  it('loads what a deep-linked URL says is open, and only that project', async () => {
    await open('/?project=p1&repo=qits-ci');
    await flushRoots([project('p1', 'qits'), project('p2', 'website')], ['qits-ci'], {
      p1: [repository('qits-ci', 'p1')],
      p2: [repository('qits-www', 'p2')],
    });

    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();

    expect(text()).toContain('r1');
    // p2 is named by no parameter, so it is shut — an explicit expansion wins outright.
    expect(text()).not.toContain('qits-www');
    http.verify();
  });

  /**
   * A URL that pinned the projects but not the one owning the repository it also named. Without the
   * repair this lands on a tree with the repository nowhere on it.
   */
  it('opens the project that owns a deep-linked repository when the URL pinned another', async () => {
    await open('/?project=p2&repo=qits-ci');
    await flushRoots([project('p1', 'qits'), project('p2', 'website')], ['qits-ci'], {
      p1: [repository('qits-ci', 'p1')],
      p2: [],
    });

    const router = TestBed.inject(Router);
    expect(router.url).toContain('project=p2,p1');
    expect(labels('.bucket .label')).not.toContain('qits-ci');

    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();
    expect(text()).toContain('r1');
    // The owner's repositories came from the index the page already holds, not a second read.
    http.verify();
  });

  it('leaves a genuinely unclaimed deep-linked repository in the bucket', async () => {
    await open('/?project=p1&repo=legacy-build-box');
    await flushRoots([project('p1', 'qits')], ['legacy-build-box'], {
      p1: [repository('qits-ci', 'p1')],
    });

    const router = TestBed.inject(Router);
    expect(router.url).toContain('project=p1');
    expect(router.url).not.toContain('p1,');
    expect(labels('.bucket .label')).toContain('legacy-build-box');

    expectRuns('legacy-build-box').flush({ runs: [run('r1')] });
    await settle();
    expect(text()).toContain('r1');
  });

  it('needs no repair at all for a bare ?repo=, because every project is already open', async () => {
    await open('/?repo=qits-ci');
    await flushRoots([project('p1', 'qits')], ['qits-ci'], { p1: [repository('qits-ci', 'p1')] });

    const router = TestBed.inject(Router);
    expect(router.url).not.toContain('project=');
    expect(labels('.bucket .label')).not.toContain('qits-ci');

    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();
    expect(text()).toContain('r1');
    http.verify();
  });

  it('asks for nothing beyond the runs when the user opens a repository by clicking', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], ['qits-ci'], { p1: [repository('qits-ci', 'p1')] });

    await click('qits-ci');
    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();

    expect(text()).toContain('r1');
    http.verify();
  });
});
