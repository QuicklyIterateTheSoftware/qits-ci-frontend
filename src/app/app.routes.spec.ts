import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { QITS_CATEGORIES, provideQitsScope } from '@qits/ui-components';
import { routes } from './app.routes';
import { NotFound } from './not-found/not-found';
import { RunPage } from './run/run-page';
import { TreePage } from './tree/tree-page';

/**
 * One page, three spellings of every address.
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
 */
describe('routes', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsScope('repository'),
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

  it('serves the tree under a repository', async () => {
    expect(await activated('/qits/services/qits-ci')).toBe(TreePage);
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

  it('serves the tree under a project', async () => {
    // Where the chrome's project picker sends this app when a reader picks `qits`.
    expect(await activated('/qits')).toBe(TreePage);
  });

  it('serves a run under a project', async () => {
    expect(await activated('/qits/runs/42')).toBe(RunPage);
  });

  it('lets its own literal segment win over the project form', async () => {
    // `/runs/42` is this app's run page, never a project called `runs` showing its tree.
    expect(await activated('/runs/42')).toBe(RunPage);
  });

  it('serves the tree under a repository addressed by its component', async () => {
    expect(await activated('/qits/qits-ci/qits-ci-service')).toBe(TreePage);
  });

  it('serves the same run under a repository addressed by its component', async () => {
    expect(await activated('/qits/qits-ci/qits-ci-service/runs/42')).toBe(RunPage);
  });

  it('serves every group, whichever way the platform names it', async () => {
    // The six categories are closed; a component is not, so the guard lets any segment through
    // that is not one of this application's own — the chrome settles what it means.
    for (const group of [...QITS_CATEGORIES, 'qits-ci', 'qits-eventstream']) {
      expect(await activated(`/qits/${group}/qits-ci-service`)).toBe(TreePage);
    }
  });

  it('never reads a category as a project', async () => {
    // `/services/…` is a category in segment one, which no project slug can be.
    expect(await activated('/services/qits-ci/runs')).toBe(NotFound);
  });
});
