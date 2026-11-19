import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsProjectList,
  provideQitsRepositoryList,
  provideQitsScope,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type { ProjectDto, RepositoryDto } from '../api/dto';

/** Where the fixture navigation says qits-projects answers — its own host, not this one. */
const PROJECTS_ORIGIN = 'https://projects.qits.example';

/**
 * What the unscoped tree draws, now that every address which used to narrow it — the project form
 * and, since qits-2320, the repository form too — hands off to the landing app instead of reaching
 * `TreePage` at all (`app.routes.spec.ts` covers the hand-off itself, and `project-redirect.spec.ts`
 * / `repository-redirect.spec.ts` cover what each one asks `NAVIGATE_AWAY` for).
 *
 * `TreePage` still reads `QITS_SCOPE` and still narrows on it — that code is not this ticket's to
 * touch, and the unscoped `?repo=` entry-placement path (`tree-page.spec.ts`) still exercises part
 * of the same machinery — but no route in this application produces a scope other than empty any
 * more, so there is no address left here through which a *narrowed* render is reachable. What is
 * left to assert is only that the bare address still draws the whole tree.
 *
 * The project and repository listings are literals here rather than requests. They are the chrome's
 * reads, not this page's, and standing them up as fixtures is what lets this spec mount the page for
 * real rather than with every dependency stubbed away.
 */
describe('TreePage unscoped', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const QITS = { id: 'p1', slug: 'qits', name: 'qits' };
  const WEBSITE = { id: 'p2', slug: 'website', name: 'website' };

  const project = (id: string, name: string): ProjectDto => ({
    id,
    name,
    slug: name,
    description: null,
    dns: null,
  });

  const repository = (id: string, name: string, projectId: string): RepositoryDto => ({
    id,
    name,
    backupUrl: `https://example.test/QuicklyIterate/${name}.git`,
    mainBranch: 'main',
    archetype: 'SERVICE',
    projectId,
  });

  /** The chrome's two listings, as literals, so the page's attribution index can actually resolve. */
  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsProjectList([QITS, WEBSITE]),
        provideQitsRepositoryList([{ id: 'r1', name: 'qits-ci', category: 'services' }], 'r0'),
        provideQitsScope('repository'),
        provideQitsNavigationTree({
          links: [],
          applications: { 'qits-projects': { origin: PROJECTS_ORIGIN } },
        }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  /**
   * Mount at a URL and answer everything the page asks for on load: the four flat reads, then one
   * repository list per project for the attribution index.
   */
  async function open(url: string): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    http
      .expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`)
      .flush({
        entries: [project('p1', 'qits'), project('p2', 'website')].map((p) => ({ project: p })),
      });
    http.expectOne('/ci/api/repositories').flush({ repositoryIds: ['r1', 'orphan'] });
    http.expectOne('/ci/api/repositories/summary').flush({ repositories: [] });
    http.expectOne('/ci/api/runs/active').flush({ runs: [] });
    http.expectOne((request) => request.url === '/ci/api/runs/finished').flush({ runs: [] });
    await settle();
    http
      .expectOne(`${PROJECTS_ORIGIN}/projects/api/projects/p1/repositories`)
      .flush({ entries: [{ repository: repository('r1', 'qits-ci', 'p1') }] });
    http.expectOne(`${PROJECTS_ORIGIN}/projects/api/projects/p2/repositories`).flush({ entries: [] });
    await settle();
  }

  function text(): string {
    return (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(() => configure());

  it('draws every project and the unattributed bucket at the bare address', async () => {
    await open('/');

    expect(text()).toContain('Not claimed by any project');
    expect(text()).toContain('website');
    expect(text()).toContain('Projects');
    http.verify();
  });
});
