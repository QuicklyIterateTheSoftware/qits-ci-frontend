import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
import { TreePage } from './tree/tree-page';
import { NAVIGATE_AWAY } from './ui/navigate-away';

/** Where the fixture navigation says `qits-landing` answers — its own host, not this one. */
const LANDING_ORIGIN = 'https://landing.qits.example';

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
 * asked `NAVIGATE_AWAY` for rather than what got drawn. Each redirect's own origin resolution —
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
        provideQitsNavigationTree({ applications: { 'qits-landing': { origin: LANDING_ORIGIN } } }),
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
    let route = TestBed.inject(Router).routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route.component;
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

  it('serves a run bare', async () => {
    expect(await activated('/runs/42')).toBe(RunPage);
  });

  it('serves the same run under a repository', async () => {
    expect(await activated('/qits/services/qits-ci/runs/42')).toBe(RunPage);
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

  it('serves a run under a project', async () => {
    expect(await activated('/qits/runs/42')).toBe(RunPage);
  });

  it('lets its own literal segment win over the project form', async () => {
    // `/runs/42` is this app's run page, never a project called `runs` showing its tree.
    expect(await activated('/runs/42')).toBe(RunPage);
  });

  it('hands the repository form off when it is addressed by its component too', async () => {
    expect(await activated('/qits/qits-ci/qits-ci-service')).toBe(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith(`${LANDING_ORIGIN}/projects/qits/ci/qits-ci-service`);
  });

  it('serves the same run under a repository addressed by its component', async () => {
    expect(await activated('/qits/qits-ci/qits-ci-service/runs/42')).toBe(RunPage);
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
