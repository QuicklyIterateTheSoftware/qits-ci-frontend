import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CiRunDto } from '../api/dto';
import { ACTIVE_POLL_INTERVAL_MS, ActiveRuns } from './active-runs';

/**
 * The right rail, and above all its cadence.
 *
 * This is the one thing in the application that polls with nothing to follow, so the assertions
 * that matter are about the *schedule*: a fixed ten seconds, nothing at all while the tab is
 * hidden, one immediate read when it comes back, and — unlike the run page — no terminal state that
 * stops it, because an empty list is the column still doing its job.
 *
 * The `changed` output is the other load-bearing piece: it is what lets the tree hold its repository
 * summaries still and refresh them only when the platform's work in flight actually moved. A poll
 * that found the same runs must emit nothing, or the saving is no saving at all.
 */
describe('ActiveRuns', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ActiveRuns>;
  let changes: number;

  const run = (id: string, over: Partial<CiRunDto> = {}): CiRunDto => ({
    id,
    repoId: 'qits-ci',
    branch: 'main',
    commitSha: '9f2c1ab3d4e5',
    status: 'RUNNING',
    createdAt: new Date(Date.now() - 127_000).toISOString(),
    finishedAt: null,
    daemonVersion: '0.4.1',
    triggerType: 'POST_RECEIVE',
    triggerEventId: null,
    triggerEventName: null,
    configPath: '.config/qits/ci-post-receive.yml',
    steps: null,
    live: null,
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

  function flushActive(runs: readonly CiRunDto[]): void {
    http.expectOne('/ci/api/runs/active').flush({ runs });
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('lists what is in flight: the repository, the status, branch@sha and an age', async () => {
    mount();
    flushActive([run('r1', { status: 'QUEUED' })]);
    await settle();

    expect(text()).toContain('QUEUED');
    expect(text()).toContain('qits-ci');
    expect(text()).toContain('main@9f2c1ab');
    expect(text()).toContain('ago');
    const link = (fixture.nativeElement as HTMLElement).querySelector('a');
    expect(link?.getAttribute('href')).toBe('/runs/r1');
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
});
