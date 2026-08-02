import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CiApi } from './ci-api';
import type { CiRunDto } from './dto';

/**
 * The paths and the envelopes, asserted once here so the pages' specs can be about rendering.
 *
 * These are same-origin absolute paths on purpose — the SPA is served at `/ci/` behind the gateway
 * that also serves `/projects/api/…`, and that is what carries the session cookie to both.
 */
describe('CiApi', () => {
  let api: CiApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CiApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps the repository ids', async () => {
    const ids = api.repositoryIds();
    http.expectOne('/ci/api/repositories').flush({ repositoryIds: ['qits-ci', 'qits-gateway'] });
    await expect(ids).resolves.toEqual(['qits-ci', 'qits-gateway']);
  });

  it('unwraps the repository summaries and keeps a repository that has never built', async () => {
    const summaries = api.repositorySummaries();
    http.expectOne('/ci/api/repositories/summary').flush({
      repositories: [
        { repositoryId: 'qits-ci', lastRun: { id: 'r1' }, lastMainRun: { id: 'r1' } },
        { repositoryId: 'qits-docs', lastRun: null, lastMainRun: null },
      ],
    });
    await expect(summaries).resolves.toHaveLength(2);
  });

  it('reads the platform-wide active list unfiltered — no repository, no limit', async () => {
    const runs = api.activeRuns();
    const request = http.expectOne('/ci/api/runs/active');
    expect(request.request.params.keys()).toEqual([]);
    request.flush({ runs: [{ id: 'r1', status: 'QUEUED' } as CiRunDto] });
    await expect(runs).resolves.toMatchObject([{ id: 'r1', status: 'QUEUED' }]);
  });

  it('reads the finished list platform-wide too, with the limit it was asked for', async () => {
    // The complement of the active list, and the only difference in how it is asked: this one is
    // unscoped by repository *and* unbounded server-side, so the bound is the caller's to send.
    const runs = api.finishedRuns(5);
    const request = http.expectOne((candidate) => candidate.url === '/ci/api/runs/finished');
    expect(request.request.params.get('limit')).toBe('5');
    expect(request.request.params.has('repositoryId')).toBe(false);
    request.flush({ runs: [{ id: 'r1', status: 'SUCCESS' } as CiRunDto] });
    await expect(runs).resolves.toMatchObject([{ id: 'r1', status: 'SUCCESS' }]);
  });

  it('asks for the newest hundred runs of one repository', async () => {
    const runs = api.runs('qits-ci', 100);
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/ci/api/runs' && candidate.params.get('repositoryId') === 'qits-ci',
    );
    expect(request.request.params.get('limit')).toBe('100');
    request.flush({ runs: [] });
    await expect(runs).resolves.toEqual([]);
  });

  it('omits the limit entirely when there is none, which is what “show all” means', async () => {
    const runs = api.runs('qits-ci');
    const request = http.expectOne((candidate) => candidate.url === '/ci/api/runs');
    expect(request.request.params.has('limit')).toBe(false);
    request.flush({ runs: [] });
    await runs;
  });

  it('reads a single run bare, not enveloped', async () => {
    const run = api.run('run-1');
    http.expectOne('/ci/api/runs/run-1').flush({ id: 'run-1', status: 'SUCCESS' } as CiRunDto);
    await expect(run).resolves.toMatchObject({ id: 'run-1', status: 'SUCCESS' });
  });

  it('cancels with a POST and accepts the empty 202 body', async () => {
    const cancelled = api.cancel('run-1');
    const request = http.expectOne('/ci/api/runs/run-1/cancel');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 202, statusText: 'Accepted' });
    await expect(cancelled).resolves.toBeUndefined();
  });

  it('sends an optional cancellation reason as JSON', async () => {
    const cancelled = api.cancel('run-1', 'No longer needed');
    const request = http.expectOne('/ci/api/runs/run-1/cancel');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reason: 'No longer needed' });
    request.flush(null, { status: 202, statusText: 'Accepted' });
    await expect(cancelled).resolves.toBeUndefined();
  });

  it('rejects with the HttpErrorResponse, so callers can read the status', async () => {
    const run = api.run('nope');
    http
      .expectOne('/ci/api/runs/nope')
      .flush({ message: 'No such run' }, { status: 404, statusText: 'Not Found' });
    await expect(run).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
