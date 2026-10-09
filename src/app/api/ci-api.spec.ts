import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CiApi } from './ci-api';
import type { CiRunDto } from './dto';

/**
 * The paths and the envelopes, asserted once here so the pages' specs can be about rendering.
 *
 * These are same-origin absolute paths on purpose — the SPA is served at `/ci/` and these are
 * qits-ci's own reads, so a relative path carries the session cookie with no CORS pre-flight. A
 * read of another application's API goes to that application's own origin instead; see `ProjectsApi`.
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

  it('retries with a POST and answers the new run id', async () => {
    // The id is the whole point of the response: the caller navigates to the run it queued.
    const retried = api.retry('run-1');
    const request = http.expectOne('/ci/api/runs/run-1/retry');
    expect(request.request.method).toBe('POST');
    request.flush({ runId: 'run-2' }, { status: 202, statusText: 'Accepted' });
    await expect(retried).resolves.toBe('run-2');
  });

  it('rejects with the HttpErrorResponse, so callers can read the status', async () => {
    const run = api.run('nope');
    http
      .expectOne('/ci/api/runs/nope')
      .flush({ message: 'No such run' }, { status: 404, statusText: 'Not Found' });
    await expect(run).rejects.toBeInstanceOf(HttpErrorResponse);
  });

  /** `concurrentBuilds` is no longer read; a server that has already dropped it decodes fine without it. */
  it('reads the queue bare, not enveloped', async () => {
    const queue = api.queue();
    http.expectOne('/ci/api/runs/queue').flush({
      generatedAt: '2026-07-31T12:00:00Z',
      running: [],
      queued: [],
      runners: [{ id: 'r1', name: 'runner-1', slots: 2, held: 1, connected: true }],
    });
    await expect(queue).resolves.toMatchObject({ runners: [{ id: 'r1' }] });
  });

  it('reads every runner and unwraps the envelope', async () => {
    const runners = api.runners();
    http.expectOne('/ci/api/runners').flush({ runners: [{ id: 'r1', name: 'runner-1' }] });
    await expect(runners).resolves.toMatchObject([{ id: 'r1', name: 'runner-1' }]);
  });

  it('creates a runner with a POST and answers its install script', async () => {
    const created = api.createRunner({ name: 'runner-1', slots: 2 });
    const request = http.expectOne('/ci/api/runners');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'runner-1', slots: 2 });
    request.flush(
      { id: 'r1', name: 'runner-1', slots: 2, installScript: '#!/bin/sh\n…' },
      { status: 201, statusText: 'Created' },
    );
    await expect(created).resolves.toMatchObject({ id: 'r1', installScript: '#!/bin/sh\n…' });
  });

  it('patches a runner with only the fields sent', async () => {
    const patched = api.patchRunner('r1', { slots: 4 });
    const request = http.expectOne('/ci/api/runners/r1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ slots: 4 });
    request.flush({ id: 'r1', name: 'runner-1', slots: 4 });
    await expect(patched).resolves.toMatchObject({ slots: 4 });
  });

  it('replaces a registration token with a POST and answers a fresh install script', async () => {
    const replaced = api.replaceRegistrationToken('r1');
    const request = http.expectOne('/ci/api/runners/r1/registration-token');
    expect(request.request.method).toBe('POST');
    request.flush({ id: 'r1', name: 'runner-1', installScript: '#!/bin/sh\n…new…' });
    await expect(replaced).resolves.toMatchObject({ installScript: '#!/bin/sh\n…new…' });
  });

  it('deletes a runner and accepts the empty 204 body', async () => {
    const deleted = api.deleteRunner('r1');
    const request = http.expectOne('/ci/api/runners/r1');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await expect(deleted).resolves.toBeUndefined();
  });

  it('rejects a delete of a runner still holding a run with the body qits-ci sends', async () => {
    const deleted = api.deleteRunner('r1');
    http
      .expectOne('/ci/api/runners/r1')
      .flush({ message: 'This runner still holds 2 runs' }, { status: 409, statusText: 'Conflict' });
    await expect(deleted).rejects.toBeInstanceOf(HttpErrorResponse);
  });

  // --- the on-demand health check and the node health report it feeds — qits-896 ---

  it('queues a health check with a POST and answers the run id plus the requestId to match against', async () => {
    const queued = api.runRunnerHealthcheck('r1');
    const request = http.expectOne('/ci/api/runners/r1/healthcheck');
    expect(request.request.method).toBe('POST');
    request.flush({ runId: 'run-99', requestId: 'req-1' }, { status: 202, statusText: 'Accepted' });
    await expect(queued).resolves.toEqual({ runId: 'run-99', requestId: 'req-1' });
  });

  it('tolerates a healthcheck response with no requestId — a runner not connected to be asked over', async () => {
    const queued = api.runRunnerHealthcheck('r1');
    http
      .expectOne('/ci/api/runners/r1/healthcheck')
      .flush({ runId: 'run-99', requestId: null }, { status: 202, statusText: 'Accepted' });
    await expect(queued).resolves.toEqual({ runId: 'run-99', requestId: null });
  });

  it('reads a runner’s node health report, checks and all', async () => {
    const health = api.runnerHealth('r1');
    const request = http.expectOne('/ci/api/runners/r1/health');
    expect(request.request.method).toBe('GET');
    request.flush({
      at: '2026-07-31T12:00:00Z',
      ok: true,
      detail: 'all checks passed',
      requestId: 'req-1',
      dataOmitted: false,
      checks: [
        { name: 'docker', ok: true, detail: 'reachable', data: { version: '24.0' } },
        {
          name: 'nodeInventory',
          ok: true,
          detail: '2 containers',
          data: {
            containers: [],
            volumes: [],
            runnerContainer: null,
          },
        },
      ],
    });
    await expect(health).resolves.toMatchObject({
      ok: true,
      checks: [{ name: 'docker' }, { name: 'nodeInventory' }],
    });
  });

  it('answers null for a 204 — the runner has never reported', async () => {
    const health = api.runnerHealth('r1');
    http
      .expectOne('/ci/api/runners/r1/health')
      .flush(null, { status: 204, statusText: 'No Content' });
    await expect(health).resolves.toBeNull();
  });
});
