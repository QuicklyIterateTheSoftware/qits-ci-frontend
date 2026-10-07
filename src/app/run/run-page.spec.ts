import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsRepositoryList,
  provideQitsScope,
  provideQitsStandardReportKinds,
  QITS_MERMAID_LOADER,
  QitsReportsClient,
  QitsRunReports,
  type QitsEntityChangesPayload,
  type QitsReport,
  type QitsRunReportsDto,
  type QitsTestFailure,
  type QitsTestResultsPayload,
} from '@qits/ui-components';
import { of } from 'rxjs';
import { routes } from '../app.routes';
import type { CiRunDto, CiStepDto, ProjectDto } from '../api/dto';
import { POLL_INTERVAL_MS } from './run-page';

/** Where the fixture navigation says qits-projects answers — its own host, not this one. */
const PROJECTS_ORIGIN = 'https://projects.qits.example';

/** Where the fixture navigation says qits-githost answers, for the test-code preview below. */
const GITHOST_ORIGIN = 'https://githost.qits.example';

/**
 * A stand-in for the library's own HTTP client, so this suite's many `http.verify()` assertions
 * stay about *this page's* requests. `<qits-run-reports>` is a real component from
 * `@qits/ui-components` — swapping only the client it reads through, as the library's own docs
 * recommend (`{ provide: QitsReportsClient, useValue: … }`), is enough to keep every report read
 * off `HttpTestingController` entirely, without a second fake component to keep in step with the
 * real one's template.
 */
function fakeReportsClient(runId: string): QitsReportsClient {
  const empty: QitsRunReportsDto = {
    runId,
    commitSha: '',
    releaseRequestId: null,
    baseline: null,
    reports: [],
  };
  return {
    origin: () => of(''),
    runReports: vi.fn(() => of(empty)),
    report: vi.fn(),
    baseline: vi.fn(() => of(null)),
    baselineReports: vi.fn(() => of([])),
  } as unknown as QitsReportsClient;
}

/**
 * Like {@link fakeReportsClient}, but the run carries one `test-results` report whose payload is
 * handed back the moment its section opens — `of(...)`, not `HttpTestingController`, the same as
 * every other report read in this file. Only the githost read an opened failure triggers below is
 * real, because that one goes through `HttpClient` rather than through this fake.
 */
function fakeReportsClientWithFailures(
  runId: string,
  failures: readonly QitsTestFailure[],
): QitsReportsClient {
  const summary = {
    id: 'report-1',
    kind: 'test-results',
    kindVersion: 1,
    stepIndex: 0,
    highlights: [],
    baselineRunId: null,
    baselineVersion: null,
    payloadBytes: 1,
    submittedAt: '2026-07-31T14:02:11Z',
  };
  const runReportsDto: QitsRunReportsDto = {
    runId,
    commitSha: '9f2c1ab3d4e5',
    releaseRequestId: null,
    baseline: null,
    reports: [summary],
  };
  const payload: QitsTestResultsPayload = {
    totals: {
      tests: failures.length,
      passed: 0,
      failed: failures.length,
      errored: 0,
      skipped: 0,
      durationMs: null,
    },
    suites: [],
    failures,
    truncated: false,
  };
  const report: QitsReport = { ...summary, payload };
  return {
    origin: () => of(''),
    runReports: vi.fn(() => of(runReportsDto)),
    report: vi.fn(() => of(report)),
    baseline: vi.fn(() => of(null)),
    baselineReports: vi.fn(() => of([])),
  } as unknown as QitsReportsClient;
}

/**
 * Like {@link fakeReportsClientWithFailures}, but the run carries one `entity-changes` v1 report
 * (qits-760): a single CHANGED unit `ci`, with both a `before` and an `after` mermaid definition —
 * the smallest payload that still exercises the Before/After switch the kind's view draws.
 */
function fakeReportsClientWithEntityChanges(runId: string): QitsReportsClient {
  const summary = {
    id: 'report-entity-1',
    kind: 'entity-changes',
    kindVersion: 1,
    stepIndex: 0,
    highlights: [],
    baselineRunId: null,
    baselineVersion: '2026.1003.52637',
    payloadBytes: 1,
    submittedAt: '2026-07-31T14:02:11Z',
  };
  const runReportsDto: QitsRunReportsDto = {
    runId,
    commitSha: '9f2c1ab3d4e5',
    releaseRequestId: null,
    baseline: null,
    reports: [summary],
  };
  const payload: QitsEntityChangesPayload = {
    baseline: { version: '2026.1003.52637', tagSha: '9f2c1ab3d4e5', hadDiagram: true },
    units: [
      {
        file: 'docs/database/ci.md',
        unit: 'ci',
        status: 'CHANGED',
        tables: [
          {
            name: 'ci_report',
            status: 'CHANGED',
            origin: 'ci',
            columns: {
              added: [],
              removed: [],
              changed: [
                { name: 'kind', before: 'string, not null, 64', after: 'string, not null, 128' },
              ],
            },
          },
        ],
        relations: { added: [], removed: [] },
        before: 'erDiagram\n  ci_report {\n    string kind "not null, length 64"\n  }\n',
        after: 'erDiagram\n  ci_report {\n    string kind "not null, length 128"\n  }\n',
      },
    ],
    truncated: false,
  };
  const report: QitsReport = { ...summary, payload };
  return {
    origin: () => of(''),
    runReports: vi.fn(() => of(runReportsDto)),
    report: vi.fn(() => of(report)),
    baseline: vi.fn(() => of(null)),
    baselineReports: vi.fn(() => of([])),
  } as unknown as QitsReportsClient;
}

/**
 * The run page, and above all the poll.
 *
 * A poll that never stops is the failure mode that will not show up in review: the page looks
 * right, the run is finished, and the tab quietly re-reads up to 320 KiB every three seconds
 * forever. So the two load-bearing assertions here are negative — no request after a terminal
 * status, and no request while the tab is hidden — and both are made with fake timers so they are
 * about the schedule rather than about wall-clock luck.
 *
 * Every spec answers the attribution lookup as well as the run read, because the page asks for both
 * at once: the run is the page, and the project that claims its repository is what makes the link
 * back into the tree land somewhere useful.
 */
describe('RunPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let reportsClient: QitsReportsClient;

  const step = (stepIndex: number, over: Partial<CiStepDto> = {}): CiStepDto => ({
    stepIndex,
    image: 'qits/build-images/node-base:latest',
    status: 'SUCCESS',
    exitCode: 0,
    startedAt: '2026-07-31T14:02:12Z',
    finishedAt: '2026-07-31T14:04:53Z',
    output: 'added 812 packages in 41s\n',
    ...over,
  });

  const run = (over: Partial<CiRunDto> = {}): CiRunDto => ({
    id: 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61',
    repoId: 'qits-ci',
    projectId: null,
    repoName: null,
    branch: 'main',
    commitSha: '9f2c1ab3d4e5',
    status: 'SUCCESS',
    createdAt: '2026-07-31T14:02:11Z',
    startedAt: '2026-07-31T14:02:12Z',
    finishedAt: '2026-07-31T14:06:23Z',
    cancellationReason: null,
    supersededByRunId: null,
    daemonVersion: '0.4.1',
    triggerType: 'POST_RECEIVE',
    triggerEventId: null,
    triggerEventName: null,
    releaseRequestId: null,
    retryOfRunId: null,
    configPath: '.config/qits/ci-post-receive.yml',
    steps: [step(0)],
    live: null,
    ...over,
  });

  beforeEach(() => {
    reportsClient = fakeReportsClient('da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The pages read what the address says is in scope; with no project list behind it this
        // resolves to nothing, which is the unscoped tree these specs are about.
        provideQitsScope('repository'),
        provideQitsNavigationTree({
          links: [],
          applications: { 'qits-projects': { origin: PROJECTS_ORIGIN } },
        }),
        // Every spec mounts `<qits-run-reports>`, so every spec gets this fake — not only the ones
        // below that assert something about it — or the rest would have to answer a request
        // `http.verify()` was never told to expect.
        { provide: QitsReportsClient, useValue: reportsClient },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  async function open(runId = 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61'): Promise<void> {
    harness = await RouterTestingHarness.create(`/runs/${runId}`);
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(page().querySelectorAll('button'));
  }

  function hasButton(label: string): boolean {
    return buttons().some((button) => (button.textContent ?? '').includes(label));
  }

  async function click(label: string): Promise<void> {
    const target = buttons().find((button) => (button.textContent ?? '').includes(label));
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  /**
   * Let the flushed responses land, their signals write, and change detection run.
   *
   * The rounds drain microtasks as well as waiting for stability, because the attribution lookup is
   * a promise chain four links long — a flushed response, a mapped envelope, a `Promise.all`, and
   * the awaiting page — and an app that is *stable* is not the same as one whose promises have all
   * settled. Too few rounds here reads as a component that never rendered its answer.
   */
  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function expectRun(runId = 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61') {
    return http.expectOne(`/ci/api/runs/${runId}`);
  }

  const project = (id: string, name: string): ProjectDto => ({
    id,
    name,
    slug: name,
    description: null,
    dns: null,
  });

  /**
   * Answer the attribution lookup: the project list, then each project's repositories. `claims`
   * maps a project id to the repository ids it owns, and the default is the platform's own shape —
   * a `qits` project that claims `qits-ci`.
   */
  async function flushAttribution(
    claims: Readonly<Record<string, readonly string[]>> = { p1: ['qits-ci'] },
  ): Promise<void> {
    const projects = Object.keys(claims).map((id) => project(id, id === 'p1' ? 'qits' : id));
    http
      .expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`)
      .flush({ entries: projects.map((entry) => ({ project: entry })) });
    await settle();
    for (const entry of projects) {
      http.expectOne(`${PROJECTS_ORIGIN}/projects/api/projects/${entry.id}/repositories`).flush({
        entries: (claims[entry.id] ?? []).map((repoId) => ({
          repository: {
            id: repoId,
            name: repoId,
            backupUrl: `https://example.test/QuicklyIterate/${repoId}.git`,
            mainBranch: 'main',
            archetype: 'SERVICE',
            projectId: entry.id,
          },
        })),
      });
    }
    await settle();
  }

  /**
   * `document.hidden` is a getter on the prototype and jsdom does not let a test assign it, so the
   * visibility a spec needs is defined onto the document itself.
   */
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  }

  /**
   * Only `setInterval` is faked, and that is deliberate. Angular's zoneless change-detection
   * scheduler races a `setTimeout` against a `requestAnimationFrame`, so faking those would freeze
   * rendering itself and `whenStable()` would never resolve. The poll is the only thing this suite
   * needs control of.
   */
  function useIntervalFakes(): void {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  }

  async function tick(millis: number): Promise<void> {
    vi.advanceTimersByTime(millis);
    await settle();
  }

  it('renders the run, its provenance and its steps', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();

    expect(text()).toContain('qits-ci');
    expect(text()).toContain('9f2c1ab');
    expect(text()).toContain('SUCCESS');
    expect(text()).toContain('31 Jul 2026 14:02:11Z');
    expect(text()).toContain('.config/qits/ci-post-receive.yml');
    expect(text()).toContain('0.4.1');
    // The last completed step's pane is the one open on arrival.
    expect(page().querySelector('.output')?.textContent).toContain('added 812 packages');
    http.verify();
  });

  /**
   * A superseded run settles `CANCELLED`, not `FAILED` — it answered no question about the commit —
   * and the note says which cancellation it was: "re-run it if the answer is still wanted" is the
   * wrong instruction for a run whose answer already exists under a newer id.
   */
  it('shows why a run was cancelled and links a deduped run to its replacement', async () => {
    await open();
    expectRun().flush(
      run({
        status: 'CANCELLED',
        cancellationReason: 'DEDUPED',
        supersededByRunId: 'newer-run',
      }),
    );
    await settle();
    await flushAttribution();

    expect(text()).toContain('DEDUPED');
    expect(text()).toContain('superseded before it started');
    expect(text()).toContain('read the newer run instead');
    expect(text()).not.toContain('re-run it if the answer is still wanted');
    const replacement = Array.from(page().querySelectorAll('a')).find((link) =>
      link.textContent?.includes('newer run'),
    );
    expect(replacement?.getAttribute('href')).toBe('/runs/newer-run');
    http.verify();
  });

  it('renders a run id that resolves to nothing as a sentence, not a crash', async () => {
    await open('nope');
    http
      .expectOne('/ci/api/runs/nope')
      .flush({ message: 'No such run' }, { status: 404, statusText: 'Not Found' });
    await settle();
    await flushAttribution();

    expect(text()).toContain('No run nope.');
    expect(page().querySelector('a[href="/"]')).not.toBeNull();
  });

  it('offers a retry when the read fails for any other reason', async () => {
    await open();
    expectRun().flush(null, { status: 503, statusText: 'Down' });
    await settle();
    await flushAttribution();

    expect(text()).toContain('Could not load this run — 503');
    await click('Retry');
    expectRun().flush(run());
    await settle();

    expect(text()).toContain('SUCCESS');
  });

  it('does not poll a terminal run at all', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();

    await tick(POLL_INTERVAL_MS * 4);
    http.verify();
  });

  it('polls a RUNNING run every three seconds, and stops on the first terminal answer', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(
      run({
        status: 'RUNNING',
        finishedAt: null,
        live: { stepIndex: 1, output: '#14 DONE 2.4s\n' },
      }),
    );
    await settle();
    await flushAttribution();

    // The live step is drawn from two fields and invents nothing else.
    expect(text()).toContain('(step 1 · live)');
    expect(text()).toContain('#14 DONE 2.4s');
    expect(text()).toContain('following');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(
      run({ status: 'RUNNING', finishedAt: null, live: { stepIndex: 1, output: 'more\n' } }),
    );
    await settle();
    expect(text()).toContain('more');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();

    // Terminal: the answer is already complete, so nothing further is read. Ever.
    await tick(POLL_INTERVAL_MS * 5);
    http.verify();
    expect(text()).not.toContain('following');
  });

  /**
   * `QUEUED` is in flight, not finished. A page that treated it as terminal would sit on the word
   * QUEUED while the build ran to completion behind it — which is the same failure as never polling,
   * arrived at from the other direction.
   */
  it('keeps reading a QUEUED run until a daemon picks it up', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'QUEUED', finishedAt: null, steps: [], live: null }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('QUEUED');
    // Nothing has started, so nothing invents a step — and no re-run either, which is a finished
    // run's. The cancel IS offered: a queued run is the case it is most worth having, since
    // stopping it costs nothing and saves the whole pipeline.
    expect(text()).not.toContain('This run recorded no steps.');
    expect(hasButton('Cancel run')).toBe(true);
    expect(hasButton('Run again')).toBe(false);

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    expect(text()).toContain('RUNNING');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();

    await tick(POLL_INTERVAL_MS * 3);
    http.verify();
  });

  it('pauses while the tab is hidden and reads once when it comes back', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    await tick(POLL_INTERVAL_MS * 3);
    http.verify(); // a hidden tab polls nothing

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();
    http.verify();
  });

  it('keeps the last good run on screen when a poll fails', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('last read failed');
    expect(text()).toContain('qits-ci');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();
    expect(text()).not.toContain('last read failed');
  });

  it('offers neither write on a terminal run — nothing to stop, and the re-run is its own button', async () => {
    // A terminal run has nothing to cancel, and the server would answer 409: a button that is
    // always refused is worse than no button.
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();
    expect(hasButton('Cancel run')).toBe(false);
  });

  it('offers no re-run while a run is still going', async () => {
    // The mirror image of the cancel's rule, and the server enforces the same line with a 409: two
    // runs racing for one verdict is not what anybody asked for.
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();
    expect(hasButton('Run again')).toBe(false);
  });

  it('offers a re-run on a terminal run, and follows the run it creates', async () => {
    await open();
    expectRun().flush(run({ status: 'FAILED' }));
    await settle();
    await flushAttribution();
    expect(hasButton('Run again')).toBe(true);

    await click('Run again');
    const retry = http.expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/retry');
    expect(retry.request.method).toBe('POST');
    retry.flush(
      { runId: 'e77f5b12-9c40-4a61-8d2f-71b3c0a9e458' },
      { status: 202, statusText: 'Accepted' },
    );
    await settle();

    // The page is addressed by run id, so staying put would leave the reader watching the run they
    // just asked to have re-done. The new run is read, which is the navigation having happened.
    expectRun('e77f5b12-9c40-4a61-8d2f-71b3c0a9e458').flush(
      run({
        id: 'e77f5b12-9c40-4a61-8d2f-71b3c0a9e458',
        status: 'QUEUED',
        startedAt: null,
        finishedAt: null,
        steps: [],
      }),
    );
    await settle();
    expect(text()).toContain('QUEUED');
  });

  it('reports a refused re-run instead of navigating', async () => {
    // Unlike the cancel's 409, this one is not a race the reader wanted the outcome of: nothing was
    // re-run, so saying nothing would leave a dead button.
    await open();
    expectRun().flush(run({ status: 'FAILED' }));
    await settle();
    await flushAttribution();

    await click('Run again');
    http
      .expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/retry')
      .flush({ message: 'not finished' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expect(text()).toContain('nothing to re-run yet');
    http.verify();
  });

  /**
   * A stopped run is neither green nor red. qits-ci publishes no build event for a `CANCELLED` run
   * at all, so nothing downstream is gated on it — and "the run is red" and "somebody stopped the
   * run" lead a reader to opposite next actions, which is why this is words rather than a badge
   * colour.
   */
  it('says what CANCELLED means, and offers the re-run beside it', async () => {
    await open();
    expectRun().flush(run({ status: 'CANCELLED', cancellationReason: 'USER_CANCELLED' }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('CANCELLED');
    expect(text()).toContain('published no verdict');
    expect(page().querySelector('.note-cancelled')).toBeTruthy();
    expect(hasButton('Run again')).toBe(true);
    expect(hasButton('Cancel run')).toBe(false);
  });

  it('names the release request a run gates and links a re-run back to its original', async () => {
    await open();
    expectRun().flush(
      run({
        status: 'FAILED',
        branch: 'release/rr-42',
        releaseRequestId: 'rr-42',
        retryOfRunId: '11111111-2222-3333-4444-555555555555',
      }),
    );
    await settle();
    await flushAttribution();

    expect(text()).toContain('Release request');
    expect(text()).toContain('rr-42');
    expect(text()).toContain('Re-run of');
    const back = Array.from(page().querySelectorAll('.facts a')).find((anchor) =>
      (anchor.getAttribute('href') ?? '').includes('11111111'),
    );
    expect(back?.getAttribute('href')).toBe('/runs/11111111-2222-3333-4444-555555555555');
  });

  it('guards cancel with a confirmation, and reconciles from the next read', async () => {
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    expect(text()).toContain('Stop this run?');
    // The question alone sends nothing.
    http.verify();

    await click('Yes, cancel it');
    const cancel = http.expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/cancel');
    expect(cancel.request.method).toBe('POST');
    cancel.flush(null, { status: 202, statusText: 'Accepted' });
    await settle();

    // The state is never assumed: the run is re-read, and that is what turns the page terminal.
    expectRun().flush(run({ status: 'FAILED', finishedAt: '2026-07-31T14:07:00Z' }));
    await settle();

    expect(text()).toContain('FAILED');
    expect(buttons().some((button) => (button.textContent ?? '').includes('Cancel run'))).toBe(
      false,
    );
  });

  it('shrugs at a 409 — the run finished between the render and the click', async () => {
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    await click('Yes, cancel it');
    http
      .expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/cancel')
      .flush({ message: 'not running' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expectRun().flush(run());
    await settle();

    expect(text()).toContain('had already finished');
    expect(text()).toContain('SUCCESS');
  });

  it('backs out of the confirmation without sending anything', async () => {
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    await click('Keep running');

    expect(text()).not.toContain('Stop this run?');
    expect(buttons().some((button) => (button.textContent ?? '').includes('Cancel run'))).toBe(
      true,
    );
    http.verify();
  });

  /**
   * The optimistic banner is the one piece of state this page asserts rather than reads, so it is
   * also the one that can outlive its truth. Measured live: a cancel left "Cancelling…" on screen
   * beside a run that had already reconciled to FAILED, because nothing retired it.
   */
  it('retires the “Cancelling…” banner the moment the run reconciles to terminal', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    await click('Yes, cancel it');
    http
      .expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/cancel')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await settle();

    // The read that follows the cancel still shows a running run: the banner is true, and stays.
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    expect(text()).toContain('Cancelling');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run({ status: 'FAILED', finishedAt: '2026-07-31T14:07:00Z' }));
    await settle();

    expect(text()).not.toContain('Cancelling');
    expect(text()).toContain('FAILED');
  });

  // --- what the run was expected to cost ---

  /** The page's text with its runs of whitespace collapsed, so a rendered phrase can be asserted. */
  function phrase(): string {
    return text().replace(/\s+/g, ' ');
  }

  /** The shared bar, which is the host element itself: `<qits-step-progress role="progressbar">`. */
  function bar(): Element | null {
    return page().querySelector('.run-progress[role="progressbar"]');
  }

  /** What the bar says the run has done, as a percentage of the expected work. */
  function barPercent(): string | null {
    return bar()?.getAttribute('aria-valuenow') ?? null;
  }

  /** One bubble per planned step, with the label drawn under it. */
  function bubbles(): string[] {
    return Array.from(page().querySelectorAll('.run-progress .qits-step-progress-label')).map(
      (label) => label.textContent?.trim() ?? '',
    );
  }

  /**
   * The comparison is the whole point of the fact, and it is worth having on a run that is *over*:
   * "4m 12s" is a number, and it only becomes fast or slow beside what this pipeline usually costs.
   */
  it('shows the expected total beside the duration, on a finished run too', async () => {
    await open();
    expectRun().flush(run({ expectedStepDurationsMillis: [10_000, 90_000] }));
    await settle();
    await flushAttribution();

    expect(phrase()).toContain('Duration4m 11s');
    expect(phrase()).toContain('Expected1m 40s');
    // Nothing to predict about a run that is over: the bar is for the ones still going.
    expect(bar()).toBeNull();
  });

  it('shows each finished step’s actual time against the time it was expected to take', async () => {
    await open();
    expectRun().flush(run({ expectedStepDurationsMillis: [10_000, 90_000] }));
    await settle();
    await flushAttribution();

    expect(phrase()).toContain('2m 41s · expected 10s');
  });

  /**
   * The live row is the one place a prediction is being watched rather than compared, so it reads
   * forwards: this is how long the current step has been going, and this is how long it usually takes.
   */
  it('ticks the live step against its own expected duration', async () => {
    await open();
    expectRun().flush(
      run({
        status: 'RUNNING',
        finishedAt: null,
        expectedStepDurationsMillis: [10_000, 38_000],
        live: {
          stepIndex: 1,
          output: '#14 DONE 2.4s\n',
          startedAt: new Date(Date.now() - 12_000).toISOString(),
        },
      }),
    );
    await settle();
    await flushAttribution();

    expect(phrase()).toContain('12s / 38s expected');
    // And the bar is drawn high on the page while the run is in flight.
    expect(bar()).not.toBeNull();
  });

  /**
   * The bar and the step rows are one reading of one set of facts, which is the whole of what this
   * epic changed. The old bar filled the **whole track** from wall-clock elapsed against the
   * predicted **total** and never looked at `steps` at all — so a step that overran ate the seams
   * after it, and a step that finished early left the next segment filling before it had started.
   *
   * Here: step 0 was expected to take 10s and really took 2m 41s, and step 1 is 12 seconds into an
   * expected 38. The first bubble is full, the second is a third full, and both say in their own
   * label exactly what the rows below say in words.
   */
  it('draws one bubble per planned step, each filled from that step’s own timings', async () => {
    await open();
    expectRun().flush(
      run({
        status: 'RUNNING',
        finishedAt: null,
        expectedStepDurationsMillis: [10_000, 38_000],
        steps: [step(0)],
        live: {
          stepIndex: 1,
          output: '#14 DONE 2.4s\n',
          startedAt: new Date(Date.now() - 12_000).toISOString(),
        },
      }),
    );
    await settle();
    await flushAttribution();

    expect(bubbles()).toEqual(['2m 41s / 10s', '12s / 38s']);
    // 10s of expected work done plus 12 of step 1's 38: 22 of the pipeline's 48.
    expect(barPercent()).toBe('46');
  });

  /**
   * A step the run has not reached is drawn and empty. This is the case the bar it replaces could
   * not express at all: with one number for the whole track, the only way to draw "step 2 has not
   * started" was to hope the total had not been overtaken.
   */
  it('leaves the bubble of a step the run has not reached empty', async () => {
    await open();
    expectRun().flush(
      run({
        status: 'QUEUED',
        startedAt: null,
        finishedAt: null,
        steps: null,
        live: null,
        expectedStepDurationsMillis: [10_000, 90_000],
      }),
    );
    await settle();
    await flushAttribution();

    expect(bubbles()).toEqual(['10s', '1m 30s']);
    expect(barPercent()).toBe('0');
  });

  /**
   * Both runs of one release carry the same `releaseRequestId`, so the id alone cannot tell the QA
   * that decides whether it ships from the build that publishes it — and those are opposite answers
   * to "what is this release waiting on".
   */
  it('says which phase of a release a gating run is', async () => {
    await open();
    expectRun().flush(run({ releaseRequestId: 'rr-1', phase: 'RELEASE' }));
    await settle();
    await flushAttribution();

    expect(phrase()).toContain('phase two · publishing the release');
  });

  /** A qits-ci too old to answer the field renders exactly as it did before the field existed. */
  it('says nothing about a phase a run does not carry', async () => {
    await open();
    expectRun().flush(run({ releaseRequestId: 'rr-1' }));
    await settle();
    await flushAttribution();

    expect(phrase()).toContain('rr-1');
    expect(phrase()).not.toContain('phase');
  });

  // --- who ran it ---

  /**
   * The executor line, on a run still going. It is not gated on `RUNNING`, unlike the progress bar
   * and the cancel button — "who ran this" is a fact about the run and not about work in flight.
   */
  it('names the runner that is executing a RUNNING run, linked to the runners page', async () => {
    await open();
    expectRun().flush(run({ status: 'RUNNING', runnerId: 'r1', runnerName: 'build-box-1' }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('Executor');
    expect(text()).toContain('build-box-1');
    const link = Array.from(page().querySelectorAll('a')).find(
      (anchor) => (anchor.textContent ?? '').trim() === 'build-box-1',
    );
    expect(link?.getAttribute('href')).toBe('/runners');
  });

  /** The same fact stays true once the run is over — it does not stop being who ran it. */
  it('names the runner on a finished run too', async () => {
    await open();
    expectRun().flush(run({ status: 'SUCCESS', runnerId: 'r1', runnerName: 'build-box-1' }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('build-box-1');
  });

  /** No runner id means a run recorded before runners existed — held by the built-in executor. */
  it('says unassigned for a run with no runner', async () => {
    await open();
    expectRun().flush(run({ runnerId: null, runnerName: null }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('unassigned');
    expect(text()).not.toContain('build-box');
  });

  /**
   * The relay's own timestamp beats this client's first sighting of the step, and the gap between
   * them is not small: a run opened mid-step was measured from *now* and read `0s` beside a step
   * that had been going for minutes.
   */
  it('measures the live step from the relay’s timestamp rather than from when it first saw it', async () => {
    await open();
    expectRun().flush(
      run({
        status: 'RUNNING',
        finishedAt: null,
        live: {
          stepIndex: 1,
          output: 'still going\n',
          startedAt: new Date(Date.now() - 132_000).toISOString(),
        },
      }),
    );
    await settle();
    await flushAttribution();

    expect(phrase()).toContain('2m 12s');
    expect(phrase()).not.toContain('/ ');
  });

  /**
   * The zero-regression case. A run from before any of this existed — no expectations, and a live
   * step with no timestamp — renders exactly what it always did: no bar, no Expected fact, and the
   * live step measured from when this client first saw it.
   */
  it('renders a run without expectations exactly as before', async () => {
    await open();
    expectRun().flush(
      run({ status: 'RUNNING', finishedAt: null, live: { stepIndex: 1, output: 'no clock\n' } }),
    );
    await settle();
    await flushAttribution();

    expect(bar()).toBeNull();
    expect(text()).not.toContain('Expected');
    expect(text()).not.toContain('expected');
    expect(phrase()).toContain('(step 1 · live) 0s');
  });

  /** The repository link, which is the only anchor in the provenance block. */
  function repoLink(): HTMLAnchorElement | null {
    return page().querySelector('.facts a');
  }

  it('names the project that claims the repository, and points the tree at it', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();

    expect(text()).toContain('· project qits');
    expect(repoLink()?.getAttribute('href')).toBe('/?project=p1&repo=qits-ci');
  });

  it('says so when no project claims the repository, and links to it alone', async () => {
    await open();
    expectRun().flush(run({ repoId: 'legacy-build-box' }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('· not claimed by any project');
    expect(repoLink()?.getAttribute('href')).toBe('/?repo=legacy-build-box');
  });

  /**
   * The public pair is what a person reads. The storage id stays the key underneath it — the
   * `?repo=` parameter is still the id, because that is what the tree is keyed by.
   */
  it('labels the run by the repository name it announced, and still keys the link by the id', async () => {
    const id = '3f6c1a9e-0b25-4d1e-9c77-2a0e5b8f4d31';
    await open();
    expectRun().flush(run({ repoId: id, projectId: 'p1', repoName: 'qits-ci' }));
    await settle();
    await flushAttribution({ p1: [id] });

    expect(text()).toContain('qits-ci');
    expect(text()).not.toContain(id);
    expect(repoLink()?.getAttribute('href')).toBe(`/?project=p1&repo=${id}`);
  });

  /**
   * A run that arrived by the public address knows its project first-hand, so the index is asked
   * only to turn that id into a name. Here it holds no repository at all and the attribution is
   * still right — which the id-keyed join alone could not have been.
   */
  it('takes the project from the run itself rather than from the repository join', async () => {
    await open();
    expectRun().flush(run({ projectId: 'p1', repoName: 'qits-ci' }));
    await settle();
    await flushAttribution({ p1: [] });

    expect(text()).toContain('· project qits');
    expect(text()).not.toContain('not claimed by any project');
  });

  /** The deep link survives a failed lookup when the run carried the project itself. */
  it('still points the tree at the project when the lookup failed but the run knew it', async () => {
    await open();
    expectRun().flush(run({ projectId: 'p1', repoName: 'qits-ci' }));
    await settle();
    http
      .expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`)
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(repoLink()?.getAttribute('href')).toBe('/?project=p1&repo=qits-ci');
    // A project *name* it does not have, so it claims none — and denies none either.
    expect(text()).not.toContain('project qits');
    expect(text()).not.toContain('not claimed by any project');
  });

  it('claims nothing at all when the lookup itself fails', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    http
      .expectOne(`${PROJECTS_ORIGIN}/projects/api/projects`)
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    // Neither an owner nor a denial: a request that never answered is not evidence of either.
    expect(text()).not.toContain('project qits');
    expect(text()).not.toContain('not claimed by any project');
    expect(repoLink()?.getAttribute('href')).toBe('/?repo=qits-ci');
  });

  // --- the report area ---

  it('hosts the generic report area below the steps, bound to the route’s run id', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();

    const area = page().querySelector('qits-run-reports');
    expect(area).not.toBeNull();
    // The element sits after the steps section in document order, as the task names it.
    const steps = page().querySelector('.steps');
    expect(steps?.compareDocumentPosition(area!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Bound to this page's own run id — the component reads through the client, so the id it was
    // asked for is the proof of the binding rather than an attribute the component need not reflect.
    expect(reportsClient.runReports).toHaveBeenCalledWith('da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61');
  });

  /**
   * The failure mode this guards against is the mirror image of the poll's own: not polling too
   * often, but telling the report area to re-read too often. `reload()` exists for exactly one
   * edge — the run went from in flight to done — and calling it on every tick while still RUNNING,
   * or again on ticks after the run already finished, would be indistinguishable from correct until
   * somebody watched the network tab.
   */
  it('reloads the report area once on the RUNNING → terminal transition, and not on every poll tick', async () => {
    useIntervalFakes();
    const reload = vi.spyOn(QitsRunReports.prototype, 'reload');
    try {
      await open();
      expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
      await settle();
      await flushAttribution();
      expect(reload).not.toHaveBeenCalled();

      // Still RUNNING: the tick must not call reload.
      await tick(POLL_INTERVAL_MS);
      expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
      await settle();
      expect(reload).not.toHaveBeenCalled();

      // The RUNNING → terminal edge: exactly one call.
      await tick(POLL_INTERVAL_MS);
      expectRun().flush(run());
      await settle();
      expect(reload).toHaveBeenCalledTimes(1);

      // Terminal already stops the poll outright, so there is nothing further to call reload on —
      // this just confirms the count never creeps up regardless.
      await tick(POLL_INTERVAL_MS * 3);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      reload.mockRestore();
    }
  });

  /** A run that arrives already terminal needs no reload: the area's own first read covers it. */
  it('does not reload the report area for a run that was already terminal on arrival', async () => {
    const reload = vi.spyOn(QitsRunReports.prototype, 'reload');
    try {
      await open();
      expectRun().flush(run());
      await settle();
      await flushAttribution();

      expect(reload).not.toHaveBeenCalled();
    } finally {
      reload.mockRestore();
    }
  });

  // --- the test code preview: the failure insights `provideQitsStandardReportKinds` now installs ---

  /**
   * One located failure — java/surefire, with a file and both ends of a line range, which is what
   * `QitsCodePreviewInsight` needs to draw the method's lines once the failure is opened. Its
   * repository names the run's own `repoId` — `qits-ci` — so `provideQitsRepositoryList` below can
   * resolve it to an id with no project in scope at all: these specs open the run at its bare
   * address, `/runs/<id>`, the same as every other test in this file.
   */
  function locatedFailure(): QitsTestFailure {
    return {
      coordinates: {
        language: 'java',
        tool: 'surefire',
        repository: { projectId: 'p1', name: 'qits-ci' },
        commitSha: '9f2c1ab3d4e5',
        file: 'service/src/test/java/eu/wohlben/qits/ci/api/CiReportResourceTest.java',
        className: 'eu.wohlben.qits.ci.api.CiReportResourceTest',
        testName: 'refusesAnotherRunsToken',
        lineStart: 3,
        lineEnd: 5,
      },
      shape: 'ASSERTION',
      failureType: 'org.opentest4j.AssertionFailedError',
      message: 'expected: <403> but was: <204>',
      stackTrace: 'at CiReportResourceTest.refusesAnotherRunsToken(CiReportResourceTest.java:4)',
      durationMs: 120,
    };
  }

  const FAILURE_FILE = 'service/src/test/java/eu/wohlben/qits/ci/api/CiReportResourceTest.java';

  /** The method `locatedFailure`'s lines 3–5 point at. */
  const METHOD_SOURCE =
    [
      'package eu.wohlben.qits.ci.api;',
      '',
      'void refusesAnotherRunsToken() {',
      '  assertEquals(403, status);',
      '}',
    ].join('\n') + '\n';

  describe('the test code preview a located failure opens', () => {
    const FILE_URL = `${GITHOST_ORIGIN}/githost/api/repositories/qits-ci/file`;

    /**
     * A fresh `TestBed`: the outer `beforeEach` already instantiated one, and these specs need a
     * different `QitsReportsClient` — one carrying a `test-results` report — plus two providers
     * none of the specs above need: `qits-githost`'s origin, so the preview knows where to read the
     * file from, and a repository listing, so the failure's repository resolves to an id at all.
     */
    beforeEach(() => {
      TestBed.resetTestingModule();
      reportsClient = fakeReportsClientWithFailures('da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61', [
        locatedFailure(),
      ]);
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes),
          provideLocationMocks(),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideQitsScope('repository'),
          provideQitsNavigationTree({
            links: [],
            applications: {
              'qits-projects': { origin: PROJECTS_ORIGIN },
              'qits-githost': { origin: GITHOST_ORIGIN },
            },
          }),
          // The other specs in this file never open a section, so they never needed the registry
          // that draws one; this is what turns the `test-results` summary below into the `Tests`
          // section and brings the failure insights — the code preview included — along with it.
          provideQitsStandardReportKinds(),
          provideQitsRepositoryList([
            { id: 'qits-ci', name: 'qits-ci', component: 'qits-ci', category: 'services' },
          ]),
          { provide: QitsReportsClient, useValue: reportsClient },
        ],
      });
      http = TestBed.inject(HttpTestingController);
    });

    /** Open the run, flush it and the attribution, then open the one `Tests` section it carries. */
    async function openWithTestsSection(): Promise<void> {
      await open();
      expectRun().flush(run());
      await settle();
      await flushAttribution();
      await click('Tests');
    }

    /**
     * Opening the failure starts `QitsSourceFiles`' read, which registers a `PendingTasks` entry
     * that only clears once the githost response lands — so `settle()`'s `whenStable()` would hang
     * here for exactly the request this test means to assert on first. A synchronous click plus one
     * `detectChanges()`, the same pairing `code-preview-insight.spec.ts` uses, is enough: the effect
     * that issues the request runs inside that same change-detection pass.
     */
    function openFailure(label: string): void {
      const target = buttons().find((button) => (button.textContent ?? '').includes(label));
      expect(target, `no button reading "${label}"`).toBeTruthy();
      target?.click();
      harness.fixture.detectChanges();
    }

    it('renders the located failure once its report section is opened', async () => {
      await openWithTestsSection();

      expect(text()).toContain('refusesAnotherRunsToken');
      expect(text()).toContain('expected: <403> but was: <204>');
    });

    it('reads githost only once the failure itself is opened, exactly once, with the session', async () => {
      await openWithTestsSection();

      // The section is open and the failure is drawn, but nothing has gone to githost yet.
      http.expectNone((request) => request.url === FILE_URL);

      openFailure('expected: <403> but was: <204>');
      const read = http.expectOne((request) => request.url === FILE_URL);
      expect(read.request.method).toBe('GET');
      expect(read.request.withCredentials).toBe(true);
      expect(read.request.params.get('rev')).toBe('9f2c1ab3d4e5');
      expect(read.request.params.get('path')).toBe(FAILURE_FILE);
      http.verify();
    });

    it('draws the excerpt from the flushed file, starting at lineStart and showing the method', async () => {
      await openWithTestsSection();
      openFailure('expected: <403> but was: <204>');
      http
        .expectOne((request) => request.url === FILE_URL)
        .flush({
          path: FAILURE_FILE,
          binary: false,
          size: METHOD_SOURCE.length,
          content: METHOD_SOURCE,
        });
      await settle();

      const excerpt = page().querySelector('qits-code-excerpt');
      expect(excerpt).not.toBeNull();
      expect(excerpt?.querySelector('ol')?.getAttribute('start')).toBe('3');
      expect(excerpt?.textContent).toContain('refusesAnotherRunsToken');
      expect(excerpt?.textContent).toContain('assertEquals(403, status)');
    });
  });

  // --- the entity-changes report (qits-760): the Entities section once the library registers it ---

  describe('the entity-changes report once @qits/ui-components registers it', () => {
    /**
     * A fresh `TestBed`, the same way the test-code-preview describe above needs one: this is the
     * one place in this file that provides `provideQitsStandardReportKinds()`, which is what turns
     * the `entity-changes` summary below into the `Entities` section instead of the generic "no
     * view for this report kind here" fallback every other spec in this file exercises implicitly.
     */
    beforeEach(() => {
      TestBed.resetTestingModule();
      reportsClient = fakeReportsClientWithEntityChanges('da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61');
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes),
          provideLocationMocks(),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideQitsScope('repository'),
          provideQitsNavigationTree({
            links: [],
            applications: { 'qits-projects': { origin: PROJECTS_ORIGIN } },
          }),
          provideQitsStandardReportKinds(),
          // `QitsMermaidDiagram` lazily `import()`s the real mermaid to draw the Before/After
          // diagrams once the section opens; this spec is about the registration reaching the
          // page, not about mermaid's own rendering, so the loader is replaced with a stub that
          // resolves without ever touching the real chunk — the library's own documented seam.
          {
            provide: QITS_MERMAID_LOADER,
            useValue: () =>
              Promise.resolve({
                initialize: () => {
                  // no-op: nothing here needs a real theme or security level applied.
                },
                render: () => Promise.resolve({ svg: '<svg></svg>' }),
              }),
          },
          { provide: QitsReportsClient, useValue: reportsClient },
        ],
      });
      http = TestBed.inject(HttpTestingController);
    });

    it('renders the Entities section for a run reporting entity-changes, with no "no view" fallback', async () => {
      await open();
      expectRun().flush(run());
      await settle();
      await flushAttribution();

      await click('Entities');

      expect(page().querySelector('qits-entity-changes-report')).not.toBeNull();
      expect(text()).not.toContain('No view for this report kind here');
    });
  });
});
