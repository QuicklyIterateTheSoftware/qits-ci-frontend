import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsScope } from '@qits/ui-components';
import { routes } from './app.routes';
import { NotFound } from './not-found/not-found';
import { RunPage } from './run/run-page';
import { TreePage } from './tree/tree-page';

/**
 * One page, two spellings of every address.
 *
 * This application is served at the root of its own host, so `/runs/42` and
 * `/qits/services/qits-ci/runs/42` are the same run seen with and without the repository the reader
 * came in through. Both have to reach the same component, or the scoped form would be a second
 * application quietly diverging from the first.
 *
 * The trap the guard exists for is the other direction: `runs` is not a project slug, and without
 * `canMatch` on the category the scoped branch would claim `/runs/42/anything` as a repository named
 * `anything`. So the literal routes are asserted to still win.
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

  it('refuses a middle segment that is not a category', async () => {
    expect(await activated('/qits/nonsense/qits-ci')).toBe(NotFound);
  });

  it('serves every category', async () => {
    for (const category of ['services', 'daemons', 'libs', 'frontends', 'cli', 'images']) {
      expect(await activated(`/qits/${category}/qits-ci`)).toBe(TreePage);
    }
  });
});
