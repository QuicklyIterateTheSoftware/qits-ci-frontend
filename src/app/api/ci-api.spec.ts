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

  it('rejects with the HttpErrorResponse, so callers can read the status', async () => {
    const run = api.run('nope');
    http
      .expectOne('/ci/api/runs/nope')
      .flush({ message: 'No such run' }, { status: 404, statusText: 'Not Found' });
    await expect(run).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
