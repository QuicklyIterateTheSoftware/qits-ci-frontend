import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CiRunDto } from '../api/dto';
import { ready } from '../ui/loadable';
import { RepoRuns } from './repo-runs';

/**
 * One repository's runs, mounted on its own: the tree's own specs drive it through the page, and
 * what is asserted here is the row itself.
 *
 * The rule the whole group turns on is which rows get a bar. A run still in flight has a prediction
 * left to make about it; a run that is over has its real duration in the column, and a bar under it
 * would be a forecast of something that already happened. So an active row draws one and a finished
 * row never does — with the columns identical either way, because the list is read by them.
 */
describe('RepoRuns', () => {
  let fixture: ComponentFixture<RepoRuns>;

  const run = (id: string, over: Partial<CiRunDto> = {}): CiRunDto => ({
    id,
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
    steps: null,
    live: null,
    ...over,
  });

  /**
   * A run in flight, 45 of its expected 100 seconds in — and, since the bar is bound to steps rather
   * than to the wall clock, *through its steps*: step 0 is over and step 1 is 35 of its 90 in.
   */
  const running = (id: string, over: Partial<CiRunDto> = {}): CiRunDto =>
    run(id, {
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 45_000).toISOString(),
      finishedAt: null,
      expectedStepDurationsMillis: [10_000, 90_000],
      steps: [
        {
          stepIndex: 0,
          image: 'qits/build-images/node-base:latest',
          status: 'SUCCESS',
          exitCode: 0,
          startedAt: new Date(Date.now() - 45_000).toISOString(),
          finishedAt: new Date(Date.now() - 35_000).toISOString(),
          output: null,
        },
      ],
      live: {
        stepIndex: 1,
        output: '',
        startedAt: new Date(Date.now() - 35_000).toISOString(),
      },
      ...over,
    });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideLocationMocks()],
    });
  });

  async function show(runs: readonly CiRunDto[]): Promise<void> {
    fixture = TestBed.createComponent(RepoRuns);
    fixture.componentRef.setInput('node', { state: ready(runs), limited: false });
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function bars(): string[] {
    return Array.from(host().querySelectorAll('[role="progressbar"]')).map(
      (track) => track.getAttribute('aria-valuenow') ?? '',
    );
  }

  function text(): string {
    return host().textContent ?? '';
  }

  /** The row's columns, which must read the same whether or not a bar is drawn under them. */
  function columns(): (string | null)[] {
    return Array.from(host().querySelectorAll('.run .duration')).map((cell) => cell.textContent);
  }

  /** Every bubble the row is drawing, by the label under it. */
  function bubbles(): string[] {
    return Array.from(host().querySelectorAll('.qits-step-progress-label')).map(
      (label) => label.textContent?.trim() ?? '',
    );
  }

  it('draws the expected shape under a row whose run is still going', async () => {
    await show([running('r1')]);

    expect(bars()).toEqual(['45']);
    expect(columns()).toEqual(['45s']);
  });

  /**
   * The bar is bound to the run's **steps** now, not to its wall clock against a predicted total.
   * Step 0 finished in the 10 seconds it was expected to take and step 1 is 35 of its 90 in — so the
   * first bubble is full and the second is a third full, rather than one length of fill smeared
   * across seams that happen to be drawn at the predicted boundaries.
   */
  it('fills each bubble from its own step rather than from the run’s elapsed total', async () => {
    await show([running('r1')]);

    expect(bubbles()).toEqual(['10s / 10s', '35s / 1m 30s']);
  });

  it('draws an empty track for a queued row, which is what a queued run has done', async () => {
    await show([running('r1', { status: 'QUEUED', startedAt: null, steps: null, live: null })]);

    expect(bars()).toEqual(['0']);
    // Drawn and empty: a queued run has the shape and has done none of it.
    expect(bubbles()).toEqual(['10s', '1m 30s']);
  });

  /**
   * The zero-regression case: a finished row is the row it always was — same columns, no bar — and
   * so is an active row on a run that predicted nothing.
   */
  it('draws no bar for a finished row, nor for an active run that predicts nothing', async () => {
    await show([
      run('done', { expectedStepDurationsMillis: [10_000, 90_000] }),
      running('r1', { expectedStepDurationsMillis: null }),
    ]);

    expect(bars()).toEqual([]);
    expect(columns()).toEqual(['4m 11s', '45s']);
    expect(text()).toContain('9f2c1ab');
  });

  /**
   * Two more cancellation reasons beyond the three `cancellationWord` already knew: neither is this
   * run breaking and neither is a person's doing, so both read like `DEDUPED` rather than like a
   * failure — and the row draws them through the same neutral `.cancelled` line every other reason
   * uses, never the badge's failed styling.
   */
  it('labels a run held by the pre-run gate as held, not failed', async () => {
    await show([run('r1', { status: 'CANCELLED', cancellationReason: 'HELD_BY_PRE_RUN_GATE' })]);

    expect(text()).toContain('held: an upstream release is still building');
  });

  it('labels a run superseded by a newer release request', async () => {
    await show([
      run('r1', { status: 'CANCELLED', cancellationReason: 'SUPERSEDED_BY_RELEASE_REQUEST' }),
    ]);

    expect(text()).toContain('superseded by a newer release request');
  });
});
