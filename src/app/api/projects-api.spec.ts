import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QITS_NAVIGATION, toNavTree, type QitsNavTree } from '@qits/ui-components';
import { ProjectsApi } from './projects-api';

const PROJECTS_ORIGIN = 'https://projects.qits.example';

/**
 * qits-projects wraps every list in `entries`, and every entry in the name of the thing it holds.
 * That is genuinely different from ci's `{runs: […]}`, so the client unwraps rather than pretends
 * the two services agree.
 *
 * Where these reads go. qits-projects answers on its own host — the edge no longer routes its
 * paths on this one — so every read is an absolute URL on the origin the navigation names, carries
 * the session, and is not made at all until the navigation has said where that origin is.
 */
describe('ProjectsApi', () => {
  let tree: WritableSignal<QitsNavTree | undefined>;
  let api: ProjectsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    tree = signal<QitsNavTree | undefined>(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: QITS_NAVIGATION, useValue: { tree, failed: signal(false) } },
      ],
    });
    api = TestBed.inject(ProjectsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function answer(applications?: Record<string, { origin: string }>): void {
    tree.set(toNavTree({ slots: {}, applications }));
    TestBed.tick();
  }

  /** Lets the awaited URL resolve, so a request that is going out has gone out. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('asks nothing before the navigation says where qits-projects is', async () => {
    void api.projects();
    TestBed.tick();
    await settle();
    http.expectNone(() => true);
    answer({ 'qits-projects': { origin: PROJECTS_ORIGIN } });
    await settle();
    http.expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`).flush({ entries: [] });
  });

  it('unwraps the project entries, with the session', async () => {
    answer({ 'qits-projects': { origin: PROJECTS_ORIGIN } });
    const projects = api.projects();
    await settle();
    const request = http.expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`);
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      entries: [
        { project: { id: 'p1', name: 'qits', slug: 'qits', description: null, dns: null } },
      ],
    });
    await expect(projects).resolves.toMatchObject([{ id: 'p1', name: 'qits' }]);
  });

  it('unwraps one project’s repository entries, with the session', async () => {
    answer({ 'qits-projects': { origin: PROJECTS_ORIGIN } });
    const repositories = api.repositories('p1');
    await settle();
    const request = http.expectOne(`${PROJECTS_ORIGIN}/projects/api/projects/p1/repositories`);
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      entries: [
        {
          repository: {
            id: 'qits-ci',
            name: 'qits-ci',
            backupUrl: 'ssh://git@example/QuicklyIterate/qits-ci.git',
            mainBranch: 'main',
            archetype: 'SERVICE',
            projectId: 'p1',
          },
        },
      ],
    });
    await expect(repositories).resolves.toMatchObject([{ id: 'qits-ci', archetype: 'SERVICE' }]);
  });

  it('keeps the same-origin path where the navigation names no origin for qits-projects', async () => {
    answer();
    void api.projects();
    await settle();
    http.expectOne('/projects/api/projects').flush({ entries: [] });
  });
});
