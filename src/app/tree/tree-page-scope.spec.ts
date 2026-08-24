import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsProjectList,
  provideQitsRepositoryList,
  provideQitsScope,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type { ProjectDto, RepositoryDto } from '../api/dto';

/**
 * What a scoped address does to the tree, which is the whole of this application's scope awareness.
 *
 * `/qits/services/qits-ci/` is a request for one repository's runs. The tree answers it by drawing
 * that project alone, opening it and the repository named, and dropping the unattributed bucket —
 * which is about no project and therefore has nothing to say inside one. Everything below that is
 * the same page: the same reads, the same expansion parameters, the same rail.
 *
 * The project and repository listings are literals here rather than requests. They are the chrome's
 * reads, not this page's, and standing them up as fixtures is what lets a spec state a scope that
 * has actually *resolved* — the ids are what the page filters on, and the slug in the URL is only
 * the way in.
 */
describe('TreePage in scope', () => {
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

  /** The chrome's two listings, as literals, so a scope can actually resolve to ids. */
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
   * Mount at a URL and answer everything the page asks for on load: the five flat reads, then one
   * repository list per project for the attribution index.
   */
  async function open(url: string): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    http
      .expectOne('/projects/api/projects')
      .flush({
        entries: [project('p1', 'qits'), project('p2', 'website')].map((p) => ({ project: p })),
      });
    http.expectOne('/ci/api/repositories').flush({ repositoryIds: ['r1', 'orphan'] });
    http.expectOne('/ci/api/repositories/summary').flush({ repositories: [] });
    http.expectOne('/ci/api/runs/active').flush({ runs: [] });
    http.expectOne((request) => request.url === '/ci/api/runs/finished').flush({ runs: [] });
    await settle();
    http
      .expectOne('/projects/api/projects/p1/repositories')
      .flush({ entries: [{ repository: repository('r1', 'qits-ci', 'p1') }] });
    http.expectOne('/projects/api/projects/p2/repositories').flush({ entries: [] });
    await settle();
  }

  function text(): string {
    return (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(() => configure());

  it('draws only the scoped project, opens the repository, and drops the bucket', async () => {
    await open('/qits/services/qits-ci');
    // The scoped repository's runs are asked for because the address opened it.
    http
      .expectOne(
        (request) => request.url === '/ci/api/runs' && request.params.get('repositoryId') === 'r1',
      )
      .flush({ runs: [] });
    await settle();

    expect(text()).toContain('qits-ci');
    expect(text()).not.toContain('website');
    expect(text()).not.toContain('Not claimed by any project');
    // The header says what is on screen rather than counting the whole platform.
    expect(text()).toContain('qits · qits-ci');
    http.verify();
  });

  it('narrows to the project when the repository named is not one of its own', async () => {
    // The project resolves and the repository does not, so the scope is effectively project-only:
    // the tree is that project's, nothing is opened, and no run list is read for a repository the
    // project does not hold.
    await open('/qits/services/not-a-repository');

    // The row is drawn — the project is on screen — but nothing under it is opened.
    expect(text()).toContain('qits-ci');
    expect(text()).not.toContain('website');
    expect(text()).not.toContain('Not claimed by any project');
    http.verify();
  });

  it('leaves the unscoped tree alone', async () => {
    await open('/');

    expect(text()).toContain('Not claimed by any project');
    expect(text()).toContain('website');
    expect(text()).toContain('Projects');
    http.verify();
  });
});
