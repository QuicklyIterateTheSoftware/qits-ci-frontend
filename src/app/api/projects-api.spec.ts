import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProjectsApi } from './projects-api';

/**
 * qits-projects wraps every list in `entries`, and every entry in the name of the thing it holds.
 * That is genuinely different from ci's `{runs: […]}`, so the client unwraps rather than pretends
 * the two services agree.
 */
describe('ProjectsApi', () => {
  let api: ProjectsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ProjectsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps the project entries', async () => {
    const projects = api.projects();
    http.expectOne('/projects/api/projects').flush({
      entries: [
        { project: { id: 'p1', name: 'qits', slug: 'qits', description: null, dns: null } },
      ],
    });
    await expect(projects).resolves.toMatchObject([{ id: 'p1', name: 'qits' }]);
  });

  it('unwraps one project’s repository entries', async () => {
    const repositories = api.repositories('p1');
    http.expectOne('/projects/api/projects/p1/repositories').flush({
      entries: [
        {
          repository: {
            id: 'qits-ci',
            url: 'ssh://git@example/QuicklyIterate/qits-ci.git',
            mainBranch: 'main',
            archetype: 'SERVICE',
            projectId: 'p1',
          },
        },
      ],
    });
    await expect(repositories).resolves.toMatchObject([{ id: 'qits-ci', archetype: 'SERVICE' }]);
  });
});
