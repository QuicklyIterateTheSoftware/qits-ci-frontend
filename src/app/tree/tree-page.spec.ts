import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { CiRunDto, ProjectDto, RepositoryDto } from '../api/dto';

/**
 * The states table, one `it` at a time, driven through `HttpTestingController`.
 *
 * The two assertions that matter most are the negative ones: that a collapsed node makes **no**
 * request, and that a failure on one node leaves the rest of the tree standing. Both are the whole
 * point of loading on expansion, and both are silent when they regress — an eager fan-out looks
 * identical on screen and simply costs forty requests.
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
    url: `https://example.test/QuicklyIterate/${id}.git`,
    mainBranch: 'main',
    archetype: 'SERVICE',
    projectId,
  });

  const run = (id: string, over: Partial<CiRunDto> = {}): CiRunDto => ({
    id,
    repoId: 'qits-ci',
    branch: 'main',
    commitSha: '9f2c1ab3d4e5',
    status: 'SUCCESS',
    createdAt: '2026-07-31T14:02:11Z',
    finishedAt: '2026-07-31T14:06:23Z',
    daemonVersion: '0.4.1',
    triggerType: 'POST_RECEIVE',
    triggerEventId: null,
    triggerEventName: null,
    configPath: '.config/qits/ci-post-receive.yml',
    steps: null,
    live: null,
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
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
   * The rounds drain microtasks as well as waiting for stability: the attribution lookup that places
   * a deep-linked repository is a promise chain several links long, and an app that is *stable* is
   * not the same as one whose promises have all settled.
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

  async function flushRoots(
    projects: readonly ProjectDto[],
    repositoryIds: readonly string[],
  ): Promise<void> {
    flushProjects(projects);
    flushRepositoryIds(repositoryIds);
    await settle();
  }

  function flushRepositories(projectId: string, repositories: readonly RepositoryDto[]): void {
    http
      .expectOne(`/projects/api/projects/${projectId}/repositories`)
      .flush({ entries: repositories.map((entry) => ({ repository: entry })) });
  }

  function expectRuns(repoId: string) {
    return http.expectOne(
      (request) => request.url === '/ci/api/runs' && request.params.get('repositoryId') === repoId,
    );
  }

  it('loads exactly two flat lists, and asks nothing about a node nobody expanded', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], ['qits-ci']);

    expect(text()).toContain('qits');
    expect(text()).toContain('1 project');
    // No repository list and no run list: the user's clicks are the bound.
    http.verify();
  });

  it('fetches a project’s repositories on expansion, and skeletons that node alone', async () => {
    await open();
    await flushRoots([project('p1', 'qits'), project('p2', 'website')], []);

    await click('qits');
    const pending = http.expectOne('/projects/api/projects/p1/repositories');
    expect(page().querySelector('.async-loading')).not.toBeNull();
    // The rest of the tree is untouched and still clickable while one node loads.
    expect(buttons().some((button) => (button.textContent ?? '').includes('website'))).toBe(true);

    pending.flush({ entries: [{ repository: repository('qits-ci', 'p1') }] });
    await settle();

    expect(page().querySelector('.async-loading')).toBeNull();
    expect(text()).toContain('qits-ci');
  });

  it('says so when a project has no repositories', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], []);

    await click('qits');
    flushRepositories('p1', []);
    await settle();

    expect(text()).toContain('This project has no repositories.');
  });

  it('says so when qits-ci has never seen a repository — an empty list, not a 404', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], []);

    await click('qits');
    flushRepositories('p1', [repository('qits-docs', 'p1')]);
    await settle();

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

  it('draws the unattributed bucket always — “0 repositories” is information', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], []);

    expect(text()).toContain('Not claimed by any project');
    expect(text()).toContain('0 repositories with CI runs');
    expect(text()).toContain('Every repository with CI runs is claimed by a project.');
  });

  it('drops a repository out of the bucket the moment a project claims it', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], ['qits-ci', 'legacy-build-box']);

    expect(labels('.bucket .label')).toContain('legacy-build-box');
    expect(labels('.bucket .label')).toContain('qits-ci');
    expect(text()).toContain('2 repositories with CI runs');

    await click('qits');
    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    await settle();

    expect(labels('.bucket .label')).toContain('legacy-build-box');
    expect(labels('.bucket .label')).not.toContain('qits-ci');
    // The count stays qits-ci's own, so it is honest whatever the tree has opened.
    expect(text()).toContain('2 repositories with CI runs');
  });

  it('shows a full-page error only when both roots fail', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 500, statusText: 'Error' });
    http.expectOne('/ci/api/repositories').flush(null, { status: 500, statusText: 'Error' });
    await settle();

    expect(text()).toContain('Could not load the tree');

    await click('Retry');
    await flushRoots([], []);

    expect(text()).not.toContain('Could not load the tree');
  });

  it('renders the bucket alone behind a banner when projects are down but qits-ci is not', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    flushRepositoryIds(['qits-ci']);
    await settle();

    expect(text()).toContain('Projects are unavailable');
    expect(text()).not.toContain('Could not load the tree');
    expect(labels('.bucket .label')).toContain('qits-ci');
  });

  it('keeps the tree standing when qits-ci is down and projects are not', async () => {
    await open();
    flushProjects([project('p1', 'qits')]);
    http.expectOne('/ci/api/repositories').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('qits');
    expect(text()).toContain('Could not load the repositories qits-ci knows — 503');

    await click('qits');
    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    await settle();

    await click('qits-ci');
    expectRuns('qits-ci').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Could not load runs — 503');
  });

  it('carries expansion in the URL, so it is bookmarkable and pressing back collapses it', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], []);

    await click('qits');
    flushRepositories('p1', []);
    await settle();

    const router = TestBed.inject(Router);
    expect(router.url).toContain('project=p1');

    await click('qits');
    expect(router.url).not.toContain('project=p1');
  });

  it('loads what a deep-linked URL says is open, and nothing else', async () => {
    await open('/?project=p1&repo=qits-ci');
    await flushRoots([project('p1', 'qits')], ['qits-ci']);

    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();

    expect(text()).toContain('r1');
    // The URL already named the project, so nothing has to be looked up to place the repository.
    http.verify();
  });

  /**
   * A `?repo=` with no `?project=` — a bookmark, or a link from a page that knew the repository and
   * not its owner. Without the lookup this landed on a tree with nothing open, the repository in the
   * unattributed bucket, and a header counting it as claimed by nobody. All three were wrong.
   */
  it('finds the project that owns a deep-linked repository and opens it there', async () => {
    await open('/?repo=qits-ci');
    await flushRoots([project('p1', 'qits')], ['qits-ci', 'legacy-build-box']);

    // The lookup asks each project for its repositories — and only that, because the project list
    // it would otherwise start from is the one this page already holds and hands over.
    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    await settle();

    const router = TestBed.inject(Router);
    expect(router.url).toContain('project=p1');
    // The repository is under its project, not in the bucket, and the runs load from there.
    expect(labels('.bucket .label')).not.toContain('qits-ci');
    expect(labels('.bucket .label')).toContain('legacy-build-box');
    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();

    expect(text()).toContain('r1');
    // The owner's repositories came from the index the lookup already built, not a second read.
    http.verify();
  });

  it('leaves a genuinely unclaimed deep-linked repository in the bucket', async () => {
    await open('/?repo=legacy-build-box');
    await flushRoots([project('p1', 'qits')], ['legacy-build-box']);

    flushRepositories('p1', [repository('qits-ci', 'p1')]);
    await settle();

    const router = TestBed.inject(Router);
    expect(router.url).not.toContain('project=');
    expect(labels('.bucket .label')).toContain('legacy-build-box');

    expectRuns('legacy-build-box').flush({ runs: [run('r1')] });
    await settle();
    expect(text()).toContain('r1');
  });

  it('does not look anything up for a repository the user opened by clicking', async () => {
    await open();
    await flushRoots([project('p1', 'qits')], ['qits-ci']);

    await click('qits-ci');
    expectRuns('qits-ci').flush({ runs: [run('r1')] });
    await settle();

    // A click is not a deep link: what the user opened is already on screen under what claims it.
    http.verify();
  });
});
