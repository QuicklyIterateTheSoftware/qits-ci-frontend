import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { QITS_CATEGORIES, provideQitsNavigationTree, provideQitsScope } from '@qits/ui-components';
import { routes } from './app.routes';
import { NotFound } from './not-found/not-found';
import { ProjectRedirect } from './project/project-redirect';
import { RepositoryRedirect } from './project/repository-redirect';
import { RunPage } from './run/run-page';
import { RUN_LOOKUP_WAIT_MS, RunRedirect } from './run/run-redirect';
import { TreePage } from './tree/tree-page';
import { NAVIGATE_AWAY } from './ui/navigate-away';

/** Where the fixture navigation says `qits-landing` answers — its own host, not this one. */
const LANDING_ORIGIN = 'https://landing.qits.example';

/** Where the fixture navigation says `qits-projects` answers, for the bare run form's slug lookup. */
const PROJECTS_ORIGIN = 'https://projects.qits.example';

/**
 * One run, three spellings of its address — and, since qits-2314 and qits-2320, two of the three
 * tree addresses hand off elsewhere instead of drawing here.
 *
 * This application is served at the root of its own host, so `/runs/42`, `/qits/runs/42` and
 * `/qits/qits-ci/qits-ci-service/runs/42` are the same run seen unscoped, under a project and under
 * the repository the reader came in through. All three have to reach the same component, or a
 * scoped form would be a second application quietly diverging from the first. The middle segment is
 * the repository's group, spelled as its component or as its archetype category; both resolve.
 *
 * The trap the guard exists for is the other direction: `runs` is not a project slug and not a
 * group, and without `canMatch` the repository branch would claim `/runs/42/anything` as a
 * repository named `anything` and `/qits/runs/42` as a repository `42`. So the literal routes are
 * asserted to still win.
 *
 * The project and repository forms' own addresses, `/<slug>` and `/<slug>/<group>/<repository>`
 * alone, are the exceptions: each reaches a redirect component (`ProjectRedirect`, qits-2314;
 * `RepositoryRedirect`, qits-2320) rather than `TreePage`, and the assertion is what that component
 * asked `NAVIGATE_AWAY` for rather than what got drawn. The run follows them (qits-2321): both
 * scoped forms reach `RunRedirect`, and the bare form reaches `RunPage` only when `handOffRun`
 * cannot name the run's project — otherwise it, too, is a `NAVIGATE_AWAY` assertion. Each redirect's own origin resolution —
 * `qits-landing`'s origin, the environment's, a relative path — is its own spec file's to cover;
 * this file only needs the one case each that proves the navigation answered in time.
 */
describe('routes', () => {
  let harness: RouterTestingHarness;
  let navigateAway: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    navigateAway = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsScope('repository'),
        provideQitsNavigationTree({
          applications: {
            'qits-landing': { origin: LANDING_ORIGIN },
            'qits-projects': { origin: PROJECTS_ORIGIN },
          },
        }),
        { provide: NAVIGATE_AWAY, useValue: navigateAway },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  /**
   * The component the URL activated — the whole question this file asks.
   *
   * The harness hands back the component of the route it mounted, which here is always the layout;
   * the page is the leaf below it, so the snapshot is walked to the bottom.
   */
  async function activated(url: string): Promise<unknown> {
    await harness.navigateByUrl(url);
    return leaf();
  }

  function leaf(): unknown {
    let route = TestBed.inject(Router).routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route.component;
  }

  /**
   * The bare run form, with `handOffRun`'s reads answered: `run` is what `GET /ci/api/runs/<id>`
   * answers (or `null` for a 500), and `projects`, when given, what the project list answers. The
   * guard holds the navigation until both have, so they are answered while it is in flight.
   */
  async function activatedBare(
    runId: string,
    run: { projectId: string | null } | null,
    projects?: readonly { id: string; slug: string }[],
  ): Promise<unknown> {
    const http = TestBed.inject(HttpTestingController);
    const navigation = harness.navigateByUrl(`/runs/${runId}`);
    const read = await vi.waitFor(() =>
      http.expectOne(`/ci/api/runs/${encodeURIComponent(runId)}`),
    );
    if (run === null) {
      read.flush(null, { status: 500, statusText: 'Down' });
    } else {
      read.flush({ id: runId, ...run });
    }
    if (projects !== undefined) {
      const list = await vi.waitFor(() =>
        http.expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`),
      );
      list.flush({
        entries: projects.map((project) => ({
          project: { ...project, name: project.slug, description: null, dns: null },
        })),
      });
    }
    await navigation;
    return leaf();
  }

  it('serves the tree bare', async () => {
    expect(await activated('/')).toBe(TreePage);
  });

  it('hands the repository form off to the landing app instead of drawing a tree', async () => {
    // The repository address no longer stays here either (qits-2320).
    expect(await activated('/qits/services/qits-ci')).toBe(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci/qits-ci`);
  });

  it('hands a bare run off to the landing app when it names a project the list knows', async () => {
    const component = await activatedBare('42', { projectId: 'p1' }, [
      { id: 'p0', slug: 'other' },
      { id: 'p1', slug: 'qits' },
    ]);
    expect(component).not.toBe(RunPage);
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci/runs/42`);
  });

  it('encodes the slug and the run id of a bare run it hands off', async () => {
    await activatedBare('a b', { projectId: 'p1' }, [{ id: 'p1', slug: 'c d' }]);
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/c%20d/ci/runs/a%20b`);
  });

  it('serves a bare run here when the run names no project', async () => {
    // No project list is read at all: there is no id to look up in it.
    expect(await activatedBare('42', { projectId: null })).toBe(RunPage);
    expect(navigateAway).not.toHaveBeenCalled();
  });

  it('serves a bare run here when no listed project carries its project id', async () => {
    expect(await activatedBare('42', { projectId: 'gone' }, [{ id: 'p1', slug: 'qits' }])).toBe(
      RunPage,
    );
    expect(navigateAway).not.toHaveBeenCalled();
  });

  it('serves a bare run here when the run read fails', async () => {
    expect(await activatedBare('42', null)).toBe(RunPage);
    expect(navigateAway).not.toHaveBeenCalled();
  });

  it('serves a bare run here when the project list read fails', async () => {
    const http = TestBed.inject(HttpTestingController);
    const navigation = harness.navigateByUrl('/runs/42');
    (await vi.waitFor(() => http.expectOne('/ci/api/runs/42'))).flush({
      id: '42',
      projectId: 'p1',
    });
    (await vi.waitFor(() => http.expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`))).flush(
      null,
      {
        status: 503,
        statusText: 'Down',
      },
    );
    await navigation;
    expect(leaf()).toBe(RunPage);
    expect(navigateAway).not.toHaveBeenCalled();
  });

  it('serves a bare run here rather than wait past its bound on a read that never answers', async () => {
    vi.useFakeTimers();
    try {
      const http = TestBed.inject(HttpTestingController);
      const navigation = harness.navigateByUrl('/runs/42');
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne('/ci/api/runs/42');
      await vi.advanceTimersByTimeAsync(RUN_LOOKUP_WAIT_MS);
      await navigation;
      expect(leaf()).toBe(RunPage);
      expect(navigateAway).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands a run under a repository off to the landing app’s run page for its project', async () => {
    expect(await activated('/qits/services/qits-ci/runs/42')).toBe(RunRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci/runs/42`);
  });

  it('lets its own literal segment win over the scoped form', async () => {
    // `runs` would otherwise read as a project slug and `42` as a category.
    expect(await activated('/runs/42/nope')).toBe(NotFound);
  });

  it('hands the project form off to the landing app instead of drawing a tree', async () => {
    // Where the chrome's project picker sends this app when a reader picks `qits` — it no longer
    // stays here (qits-2314).
    expect(await activated('/qits')).toBe(ProjectRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci`);
  });

  it('keeps a category its own tree rather than handing it off as a project', async () => {
    for (const category of QITS_CATEGORIES) {
      expect(await activated(`/${category}`)).toBe(TreePage);
    }
    expect(navigateAway).not.toHaveBeenCalled();
  });

  it('hands a run under a project off to the landing app’s run page for that project', async () => {
    expect(await activated('/qits/runs/42')).toBe(RunRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci/runs/42`);
  });

  it('encodes the project and the run id of a scoped run', async () => {
    expect(await activated('/a%20b/runs/c%20d')).toBe(RunRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/a%20b/ci/runs/c%20d`);
  });

  it('encodes the project and the run id of a run under a repository', async () => {
    expect(await activated('/a%20b/services/qits-ci/runs/c%20d')).toBe(RunRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/a%20b/ci/runs/c%20d`);
  });

  it('lets its own literal segment win over the project form', async () => {
    // `/runs/42` is this app's run address, never a project called `runs` showing its tree.
    expect(await activatedBare('42', { projectId: null })).toBe(RunPage);
  });

  it('hands the repository form off when it is addressed by its component too', async () => {
    expect(await activated('/qits/qits-ci/qits-ci-service')).toBe(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci/qits-ci-service`);
  });

  it('hands a run under a repository addressed by its component off the same way', async () => {
    expect(await activated('/qits/qits-ci/qits-ci-service/runs/42')).toBe(RunRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci/runs/42`);
  });

  it('hands the repository form off whichever way the platform names the group', async () => {
    // The six categories are closed; a component is not, so the guard lets any segment through
    // that is not one of this application's own — the destination drops the group either way
    // (qits-2320), so every spelling lands on the same landing address.
    for (const group of [...QITS_CATEGORIES, 'qits-ci', 'qits-eventstream']) {
      expect(await activated(`/qits/${group}/qits-ci-service`)).toBe(RepositoryRedirect);
      await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
      expect(navigateAway).toHaveBeenLastCalledWith(
        `${LANDING_ORIGIN}/projects/qits/ci/qits-ci-service`,
      );
    }
  });

  it('never reads a category as a project', async () => {
    // `/services/…` is a category in segment one, which no project slug can be.
    expect(await activated('/services/qits-ci/runs')).toBe(NotFound);
  });
});
