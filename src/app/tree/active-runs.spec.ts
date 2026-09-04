import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CiRunDto } from '../api/dto';
import { ACTIVE_POLL_INTERVAL_MS, ActiveRuns, FINISHED_SEED_COUNT } from './active-runs';

/**
 * The right rail: its cadence, and the stack of finished runs above it.
 *
 * This is the one thing in the application that polls with nothing to follow, so the assertions
 * that matter are about the *schedule*: a fixed ten seconds, nothing at all while the tab is
 * hidden, one immediate read when it comes back, and — unlike the run page — no terminal state that
 * stops it, because an empty list is the column still doing its job.
 *
 * The `changed` output is the other load-bearing piece: it is what lets the tree hold its repository
 * summaries still and refresh them only when the platform's work in flight actually moved. A poll
 * that found the same runs must emit nothing, or the saving is no saving at all.
 *
 * The finished stack's own rule is **append-only**, and most of what is asserted below is that
 * nothing else ever happens to it: it seeds at five, it grows, it never re-orders, it never drops a
 * row, and it never shows one run twice however many polls re-report it.
 */
describe('ActiveRuns', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ActiveRuns>;
  let changes: number;

  const run = (id: string, over: Partial<CiRunDto> = {}): CiRunDto => ({
    id,
    repoId: 'qits-ci',
    projectId: null,
    repoName: null,
    branch: 'main',
    commitSha: '9f2c1ab3d4e5',
    status: 'RUNNING',
    createdAt: new Date(Date.now() - 127_000).toISOString(),
    startedAt: new Date(Date.now() - 127_000).toISOString(),
    finishedAt: null,
    cancellationReason: null,
    supersededByRunId: null,
    daemonVersion: '0.4.1',
    triggerType: 'POST_RECEIVE',
    triggerEventId: null,
    triggerEventName: null,
    releaseRequestId: null,
    retryOfRunId: null,
    configPath: '.config/qits/ci-post-receive.yml',
    steps: null,
    live: null,
    ...over,
  });

  /**
   * A fixed instant `minute` minutes past a base, so a spec *states* an ordering rather than racing
   * one. The stack's whole contract is an order, and `Date.now()` cannot express one.
   */
  const at = (minute: number): string => new Date(Date.UTC(2026, 6, 31, 12, minute)).toISOString();

  /** A run that is over, with the `createdAt` its position in the stack is decided by. */
  const done = (id: string, minute: number, over: Partial<CiRunDto> = {}): CiRunDto =>
    run(id, {
      status: 'SUCCESS',
      createdAt: at(minute),
      finishedAt: at(minute + 1),
      ...over,
    });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    changes = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

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
   * needs control of — and it has to be faked *before* the component is created, because this
   * column starts its interval on construction rather than on its first answer.
   */
  function useIntervalFakes(): void {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  }

  function mount(): void {
    fixture = TestBed.createComponent(ActiveRuns);
    fixture.componentInstance.changed.subscribe(() => (changes += 1));
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
  }

  async function tick(millis: number): Promise<void> {
    vi.advanceTimersByTime(millis);
    await settle();
  }

  /**
   * One tick's worth of answers. Both listings are asked on every tick, so a spec that answered
   * only one would leave the other outstanding and `http.verify()` would say so.
   */
  function flushActive(active: readonly CiRunDto[], finished: readonly CiRunDto[] = []): void {
    http.expectOne('/ci/api/runs/active').flush({ runs: active });
    flushFinished(finished);
  }

  /** The finished listing answers newest-first, exactly as the server does. */
  function flushFinished(runs: readonly CiRunDto[]): void {
    http.expectOne((request) => request.url === '/ci/api/runs/finished').flush({ runs });
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** Every run link in document order — the stack sits above the active list, so order is content. */
  function links(): readonly string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a')).map(
      (anchor) => anchor.getAttribute('href') ?? '',
    );
  }

  it('lists what is in flight: the repository, the status, branch@sha and an age', async () => {
    mount();
    flushActive([run('r1', { status: 'QUEUED' })]);
    await settle();

    expect(text()).toContain('QUEUED');
    expect(text()).toContain('qits-ci');
    expect(text()).toContain('main@9f2c1ab');
    expect(text()).toContain('queued for 2m 07s');
    expect(links()).toEqual(['/runs/r1']);
  });

  /**
   * The storage id is a UUID nobody can read. A run that announced its public name is labelled by
   * it, in both lists, and a run that announced none still says the only thing it knows.
   */
  it('labels a run by its repository name, and by its storage id when it has none', async () => {
    const id = '3f6c1a9e-0b25-4d1e-9c77-2a0e5b8f4d31';
    mount();
    flushActive(
      [run('r1', { repoId: id, projectId: 'p1', repoName: 'qits-ci' })],
      [done('r0', 4, { repoId: id })],
    );
    await settle();

    expect(text()).toContain('qits-ci');
    expect(text()).toContain(id);
  });

  it('restarts the elapsed timer when a queued run begins executing', async () => {
    mount();
    flushActive([
      run('r1', {
        status: 'RUNNING',
        createdAt: new Date(Date.now() - 600_000).toISOString(),
        startedAt: new Date(Date.now() - 7_000).toISOString(),
      }),
    ]);
    await settle();

    expect(text()).toContain('running for 7s');
    expect(text()).not.toContain('10m');
  });

  it('says nothing is building rather than drawing an empty box', async () => {
    mount();
    flushActive([]);
    await settle();

    expect(text()).toContain('Nothing building right now.');
  });

  it('re-reads every ten seconds and keeps going on an empty answer', async () => {
    useIntervalFakes();
    mount();
    flushActive([]);
    await settle();

    // Nothing in flight is not a terminal state: discovering the first run is the column's job.
    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([]);
    await settle();

    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([run('r1')]);
    await settle();
    expect(text()).toContain('qits-ci');

    // And it does not stop once it has found something, either.
    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([run('r1')]);
    await settle();
    http.verify();
  });

  it('reads nothing while the tab is hidden and once as soon as it comes back', async () => {
    useIntervalFakes();
    mount();
    flushActive([run('r1')]);
    await settle();

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    await tick(ACTIVE_POLL_INTERVAL_MS * 3);
    http.verify(); // a hidden tab polls nothing

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    flushActive([run('r1')]);
    await settle();

    // …and the interval takes over again from there.
    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([run('r1')]);
    await settle();
    http.verify();
  });

  it('announces a change only when the runs in flight are different runs', async () => {
    useIntervalFakes();
    mount();
    flushActive([run('r1')]);
    await settle();
    // The first answer is the baseline: the tree read its summaries beside this read.
    expect(changes).toBe(0);

    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([run('r1', { createdAt: '2026-07-31T15:20:00Z' })]);
    await settle();
    expect(changes).toBe(0);

    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([run('r1'), run('r2')]);
    await settle();
    expect(changes).toBe(1);

    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([run('r2')]);
    await settle();
    expect(changes).toBe(2);
  });

  it('keeps the last known list on screen when a poll fails, and says so', async () => {
    useIntervalFakes();
    mount();
    flushActive([run('r1')]);
    await settle();

    await tick(ACTIVE_POLL_INTERVAL_MS);
    http.expectOne('/ci/api/runs/active').flush(null, { status: 503, statusText: 'Down' });
    flushFinished([]);
    await settle();

    expect(text()).toContain('last read failed');
    expect(text()).toContain('qits-ci');

    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([run('r1')]);
    await settle();
    expect(text()).not.toContain('last read failed');
  });

  it('offers a retry when the very first read fails, because there is nothing to keep', async () => {
    mount();
    http.expectOne('/ci/api/runs/active').flush(null, { status: 503, statusText: 'Down' });
    flushFinished([]);
    await settle();

    expect(text()).toContain('Could not load the runs in flight — 503');
    const retry = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => (button.textContent ?? '').includes('Retry'));
    retry?.click();
    await settle();

    flushActive([run('r1')]);
    await settle();
    expect(text()).not.toContain('Could not load the runs in flight');
    expect(text()).toContain('qits-ci');
  });

  // --- the finished stack ---

  it('seeds the stack with the newest five, oldest at the top and above the active list', async () => {
    mount();
    // The server answers newest first; the stack is drawn the other way up, so it reads forwards in
    // time down the page and into the runs still in flight.
    flushActive(
      [run('a1')],
      [done('f5', 5), done('f4', 4), done('f3', 3), done('f2', 2), done('f1', 1)],
    );
    await settle();

    expect(links()).toEqual([
      '/runs/f1',
      '/runs/f2',
      '/runs/f3',
      '/runs/f4',
      '/runs/f5',
      '/runs/a1',
    ]);
    expect(text()).toContain('Finished runs');
    expect(text()).toContain('SUCCESS');
  });

  it('asks for exactly five and draws no stack at all when nothing has ever finished', async () => {
    mount();
    const request = http.expectOne((call) => call.url === '/ci/api/runs/finished');
    expect(request.request.params.get('limit')).toBe(String(FINISHED_SEED_COUNT));
    request.flush({ runs: [] });
    http.expectOne('/ci/api/runs/active').flush({ runs: [] });
    await settle();

    // An empty heading over nothing is noise; the active section already says the platform is idle.
    expect(text()).not.toContain('Finished runs');
  });

  it('appends a run to the bottom of the stack when it finishes, and drops it from active', async () => {
    useIntervalFakes();
    mount();
    flushActive([run('r9', { createdAt: at(9) })], [done('f1', 1)]);
    await settle();
    expect(links()).toEqual(['/runs/f1', '/runs/r9']);

    // The run leaves the active listing and turns up in the finished one on the same tick — which
    // is the whole of how this column detects a completion.
    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([], [done('r9', 9), done('f1', 1)]);
    await settle();

    expect(links()).toEqual(['/runs/f1', '/runs/r9']);
    expect(text()).toContain('Nothing building right now.');
    // A finished run appearing where a running one was is a change the tree has to hear about.
    expect(changes).toBe(1);
  });

  it('appends a run that was never seen active, because it started and finished between polls', async () => {
    useIntervalFakes();
    mount();
    flushActive([], [done('f1', 1)]);
    await settle();
    expect(changes).toBe(0);

    // Nothing entered or left the active set — it was empty before and after — so the id-set test
    // alone would have reported no change at all and this run would be invisible until a reload.
    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([], [done('quick', 2), done('f1', 1)]);
    await settle();

    expect(links()).toEqual(['/runs/f1', '/runs/quick']);
    expect(changes).toBe(1);
  });

  it('shows a run once however many polls keep reporting it', async () => {
    useIntervalFakes();
    mount();
    flushActive([], [done('f2', 2), done('f1', 1)]);
    await settle();

    // The server keeps answering with its newest five, so every one of these repeats rows the stack
    // already holds. Keyed by id, none of them is a second row.
    for (let poll = 0; poll < 3; poll += 1) {
      await tick(ACTIVE_POLL_INTERVAL_MS);
      flushActive([], [done('f2', 2), done('f1', 1)]);
      await settle();
    }

    expect(links()).toEqual(['/runs/f1', '/runs/f2']);
    expect(changes).toBe(0);
  });

  it('never trims: five rows become six, then seven, for as long as the view is open', async () => {
    useIntervalFakes();
    mount();
    flushActive([], [done('f5', 5), done('f4', 4), done('f3', 3), done('f2', 2), done('f1', 1)]);
    await settle();
    expect(links().length).toBe(FINISHED_SEED_COUNT);

    // The server's answer stays five rows long — it is a *newest five* — while the stack grows past
    // it. Re-seeding on each poll would silently drop f1 and f2 here.
    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([], [done('f6', 6), done('f5', 5), done('f4', 4), done('f3', 3), done('f2', 2)]);
    await settle();
    expect(links().length).toBe(6);

    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([], [done('f7', 7), done('f6', 6), done('f5', 5), done('f4', 4), done('f3', 3)]);
    await settle();

    expect(links()).toEqual([
      '/runs/f1',
      '/runs/f2',
      '/runs/f3',
      '/runs/f4',
      '/runs/f5',
      '/runs/f6',
      '/runs/f7',
    ]);
  });

  it('appends several completions in chronological order, and ignores one older than the stack', async () => {
    useIntervalFakes();
    mount();
    flushActive([], [done('f5', 5)]);
    await settle();

    // Two finished since the last poll, plus a straggler that started before the bottom row. The
    // two are appended oldest-first; the straggler is dropped rather than inserted, because putting
    // it in place would move rows the user has already read.
    await tick(ACTIVE_POLL_INTERVAL_MS);
    flushActive([], [done('f7', 7), done('f6', 6), done('old', 3), done('f5', 5)]);
    await settle();

    expect(links()).toEqual(['/runs/f5', '/runs/f6', '/runs/f7']);
  });

  it('keeps the stack it has when the finished read fails, and says nothing about it', async () => {
    useIntervalFakes();
    mount();
    flushActive([run('r1')], [done('f1', 1)]);
    await settle();

    await tick(ACTIVE_POLL_INTERVAL_MS);
    http.expectOne('/ci/api/runs/active').flush({ runs: [run('r1')] });
    http
      .expectOne((call) => call.url === '/ci/api/runs/finished')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    // History that did not refresh is not a failure worth a banner: the active list is this
    // column's content and it arrived.
    expect(links()).toEqual(['/runs/f1', '/runs/r1']);
    expect(text()).not.toContain('last read failed');
  });
});
