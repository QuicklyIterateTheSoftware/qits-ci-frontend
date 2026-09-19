import type { CiLiveStepDto, CiStepDto } from '../api/dto';
import {
  hasExpectations,
  progressSteps,
  totalExpectedMillis,
  type ExpectedStepsRun,
} from './expected-steps';

/**
 * The one mapping from a run to a bar, and the two rules in it that cannot be checked by looking.
 *
 * **The spine is the prediction, not the history.** One entry per expectation, always, so a step the
 * run has not reached is present and empty rather than missing — that is what makes the boundaries
 * the pipeline's boundaries instead of a running total's.
 *
 * **The timestamps are keyed by `stepIndex`.** A step is persisted when it ends, so mid-run the
 * `steps` array is shorter than the pipeline and its element order says nothing about which step is
 * which. Every assertion below that uses a short array is guarding against the positional reading,
 * which is silently right on a run that completed and silently wrong on every other.
 */
describe('progressSteps', () => {
  const step = (stepIndex: number, over: Partial<CiStepDto> = {}): CiStepDto => ({
    stepIndex,
    image: 'qits/build-images/node-base:latest',
    status: 'SUCCESS',
    exitCode: 0,
    startedAt: '2026-07-31T14:02:12Z',
    finishedAt: '2026-07-31T14:04:53Z',
    output: null,
    ...over,
  });

  const run = (over: Partial<ExpectedStepsRun> = {}): ExpectedStepsRun => ({
    expectedStepDurationsMillis: [10_000, 90_000],
    steps: null,
    live: null,
    ...over,
  });

  // --- the spine ---

  it('answers one entry per planned step, in pipeline order, whatever has run', () => {
    expect(progressSteps(run({ expectedStepDurationsMillis: [10_000, 90_000, 5000] }))).toEqual([
      { expectedMillis: 10_000, startedAt: null, finishedAt: null },
      { expectedMillis: 90_000, startedAt: null, finishedAt: null },
      { expectedMillis: 5000, startedAt: null, finishedAt: null },
    ]);
  });

  /**
   * A queued run has the shape and has done none of it. Every bubble is drawn and every one is
   * empty, which is the honest picture and the one the old bar could not draw.
   */
  it('leaves every step unstarted for a run that has not begun', () => {
    expect(progressSteps(run()).every((step) => step.startedAt === null)).toBe(true);
  });

  // --- keyed by stepIndex, never by position ---

  /**
   * The case that breaks a positional reading, and the ordinary shape of a run in flight: three
   * planned steps and one recorded one. Read by position, step 0's timings would land on step 0 —
   * correct here by luck — so the spec below uses a gap to make the difference visible.
   */
  it('hangs a recorded step on its own index, not on its position in the array', () => {
    const steps = progressSteps(
      run({
        expectedStepDurationsMillis: [10_000, 90_000, 5000],
        // Step 1 was SKIPPED and never persisted: the array's only element is step 2.
        steps: [step(2, { startedAt: '2026-07-31T14:10:00Z', finishedAt: '2026-07-31T14:10:04Z' })],
      }),
    );

    expect(steps[0]).toEqual({ expectedMillis: 10_000, startedAt: null, finishedAt: null });
    expect(steps[1]).toEqual({ expectedMillis: 90_000, startedAt: null, finishedAt: null });
    expect(steps[2]).toEqual({
      expectedMillis: 5000,
      startedAt: '2026-07-31T14:10:00Z',
      finishedAt: '2026-07-31T14:10:04Z',
    });
  });

  it('carries a mid-run short array without attributing it to the wrong steps', () => {
    const steps = progressSteps(
      run({
        expectedStepDurationsMillis: [10_000, 90_000, 5000, 20_000],
        steps: [step(0), step(1)],
        live: { stepIndex: 2, output: '', startedAt: '2026-07-31T14:06:00Z' },
      }),
    );

    expect(steps.map((step) => step.finishedAt)).toEqual([
      '2026-07-31T14:04:53Z',
      '2026-07-31T14:04:53Z',
      null,
      null,
    ]);
    expect(steps[2].startedAt).toBe('2026-07-31T14:06:00Z');
    expect(steps[3].startedAt).toBeNull();
  });

  // --- live never overrides a persisted fact ---

  it('takes the in-flight step’s start from live, for the index live names', () => {
    const steps = progressSteps(
      run({ live: { stepIndex: 1, output: '', startedAt: '2026-07-31T14:05:00Z' } }),
    );

    expect(steps[0].startedAt).toBeNull();
    expect(steps[1]).toEqual({
      expectedMillis: 90_000,
      startedAt: '2026-07-31T14:05:00Z',
      finishedAt: null,
    });
  });

  /**
   * A stale pointer must not reopen a finished step. The recorded step wins outright — timestamps
   * *and* the finish — because a persisted step is a fact and a live pointer is a claim about now.
   * Were live allowed to win, the bubble would go back to filling and never complete.
   */
  it('never lets a stale live pointer override a step that is already persisted', () => {
    const steps = progressSteps(
      run({
        steps: [step(1, { startedAt: '2026-07-31T14:03:00Z', finishedAt: '2026-07-31T14:04:00Z' })],
        live: { stepIndex: 1, output: '', startedAt: '2026-07-31T14:09:00Z' },
      }),
    );

    expect(steps[1]).toEqual({
      expectedMillis: 90_000,
      startedAt: '2026-07-31T14:03:00Z',
      finishedAt: '2026-07-31T14:04:00Z',
    });
  });

  /**
   * A daemon older than `live.startedAt` gets an unstarted bubble rather than an invented instant.
   * Nothing here measures anything: a prediction must never read as a promise, and a start time the
   * client made up would be exactly that.
   */
  it('invents no start for a relay that answers no timestamp', () => {
    const live = { stepIndex: 1, output: '' } as CiLiveStepDto;

    expect(progressSteps(run({ live }))[1].startedAt).toBeNull();
  });

  // --- nothing to predict from ---

  it('answers the empty list for exactly the runs hasExpectations refuses', () => {
    for (const expected of [undefined, null, [], [10_000, 0], [-1], [10_000, Number.NaN]]) {
      const value = run({ expectedStepDurationsMillis: expected });
      expect(progressSteps(value)).toEqual([]);
      expect(hasExpectations(value)).toBe(false);
    }
  });

  /**
   * A `CiRunDto` is immutable, so the mapping is a pure function of its identity and is remembered
   * by it. That is not an optimisation: a template re-evaluates `progressSteps(run)` on every
   * change-detection pass, and a fresh array each time would hand the bar a new input every second.
   */
  it('answers the same array for the same run, so a template binding is stable', () => {
    const value = run({ steps: [step(0)] });

    expect(progressSteps(value)).toBe(progressSteps(value));
    expect(progressSteps(run({ steps: [step(0)] }))).not.toBe(progressSteps(value));
  });

  describe('totalExpectedMillis', () => {
    it('sums the steps', () => {
      expect(totalExpectedMillis([10_000, 90_000])).toBe(100_000);
    });

    /**
     * One bad entry poisons the whole prediction rather than one step: every bubble is a share of
     * this total, so a zero or a negative would silently move every other step's boundary. Drawing
     * nothing is the only honest answer.
     */
    it('answers null for absence and for nonsense alike', () => {
      expect(totalExpectedMillis(undefined)).toBeNull();
      expect(totalExpectedMillis(null)).toBeNull();
      expect(totalExpectedMillis([])).toBeNull();
      expect(totalExpectedMillis([0])).toBeNull();
      expect(totalExpectedMillis([1000, -1])).toBeNull();
    });
  });

  describe('hasExpectations', () => {
    it('is the question a caller asks before it spends layout on a bar', () => {
      expect(hasExpectations(run())).toBe(true);
      expect(hasExpectations(run({ expectedStepDurationsMillis: null }))).toBe(false);
      expect(hasExpectations(run({ expectedStepDurationsMillis: [] }))).toBe(false);
    });
  });
});
