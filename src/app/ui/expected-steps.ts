import type { QitsStepProgressStep } from '@qits/ui-components';
import type { CiRunDto } from '../api/dto';

/**
 * What the bar reads off a run, and the whole of it: the shape the pipeline is expected to take, and
 * the timestamps of the steps that have actually run.
 *
 * A `Pick` rather than a whole `CiRunDto` because every caller has one of those anyway and none of
 * them has to build one — the listings, the tree rows and the run page all pass the run they already
 * hold.
 */
export type ExpectedStepsRun = Pick<CiRunDto, 'expectedStepDurationsMillis' | 'steps' | 'live'>;

/**
 * How long the whole pipeline is expected to take, or null when there is nothing to predict from.
 *
 * Null covers absence and nonsense alike — no field, an empty list, or an entry that is not a
 * positive number — because every caller does the same thing with all of them: render exactly what
 * it rendered before expectations existed. A partial prediction is worse than none: every bubble is
 * a share of this total, so one bad entry would move every other step's boundary.
 */
export function totalExpectedMillis(expected: readonly number[] | null | undefined): number | null {
  if (!expected || expected.length === 0) {
    return null;
  }
  let total = 0;
  for (const step of expected) {
    if (!Number.isFinite(step) || step <= 0) {
      return null;
    }
    total += step;
  }
  return total;
}

/**
 * Whether this run predicts anything at all — the question a caller asks before it draws a bar, and
 * before it spends the layout around one.
 *
 * {@link progressSteps} answers the empty list for exactly the same runs, so mounting the bar
 * unconditionally is safe; this exists for the margins and table cells that would otherwise be
 * spacing for an element drawing nothing.
 */
export function hasExpectations(run: Pick<CiRunDto, 'expectedStepDurationsMillis'>): boolean {
  return totalExpectedMillis(run.expectedStepDurationsMillis) !== null;
}

/**
 * The identity cache behind {@link progressSteps}.
 *
 * A `CiRunDto` is immutable — a poll answers a *new* object rather than mutating the one on screen —
 * so the mapping is a pure function of the run's identity and is safe to remember by it. That
 * matters for a template rather than for speed: `[steps]="progressSteps(run)"` is re-evaluated on
 * every change-detection pass, and a fresh array each time would hand the bar a new input a second,
 * invalidating its computed state and tripping Angular's dev-mode "expression changed" check.
 *
 * Weak, so remembering a run keeps nothing alive: the entry dies with the answer it was derived from.
 */
const memo = new WeakMap<object, readonly QitsStepProgressStep[]>();

/**
 * A run's **planned** steps, as `<qits-step-progress>` wants them: one entry per expectation, in
 * pipeline order, carrying whatever this run has actually done in that step.
 *
 * <h3>Why the expectations are the spine</h3>
 *
 * The list is one entry per `expectedStepDurationsMillis` index and never one entry per recorded
 * step, because the bar is a picture of the pipeline rather than of the history so far. A step the
 * run has not reached is present, drawn and empty — which is the whole of what makes the boundaries
 * true, and the difference from the bar this replaces, which drew the seams from the prediction and
 * then filled the whole track from wall-clock elapsed against the predicted total.
 *
 * <h3>Why the timestamps are keyed by `stepIndex`</h3>
 *
 * `steps` is **not** positionally aligned with the expectations. A step is persisted when it *ends*,
 * so mid-run the array is shorter than the pipeline, and its element order says nothing about which
 * step is which — the same reason {@link RunPage.expectedStep} keys this way for the rows it draws
 * beside each step. Reading `steps[i]` would attribute step 3's timestamps to step 0 on any run that
 * skipped a step or is still going.
 *
 * <h3>Why `live` never wins</h3>
 *
 * `live.stepIndex` is the one place the in-flight step's `startedAt` comes from, and it is consulted
 * **only** for an index no recorded step claims. A persisted step is a finished fact; a live pointer
 * is a claim about now, and a stale one reopening a step that has already ended would draw a
 * finished bubble as running and never let it complete. Persisted wins, always.
 *
 * <p>A relay too old to answer `live.startedAt` leaves the in-flight bubble empty rather than being
 * given an invented instant — the component draws "not started", which is the honest reading of
 * "something is running and nobody recorded when it began".
 *
 * @returns the planned steps, or the empty list for a run that predicts nothing — see
 *     {@link hasExpectations}, which is the same question.
 */
export function progressSteps(run: ExpectedStepsRun): readonly QitsStepProgressStep[] {
  const remembered = memo.get(run);
  if (remembered) {
    return remembered;
  }
  const steps = derive(run);
  memo.set(run, steps);
  return steps;
}

function derive(run: ExpectedStepsRun): readonly QitsStepProgressStep[] {
  const expected = run.expectedStepDurationsMillis;
  if (!expected || totalExpectedMillis(expected) === null) {
    return [];
  }
  const recorded = new Map((run.steps ?? []).map((step) => [step.stepIndex, step]));
  const live = run.live;
  return expected.map((expectedMillis, stepIndex) => {
    const step = recorded.get(stepIndex);
    if (step) {
      return { expectedMillis, startedAt: step.startedAt, finishedAt: step.finishedAt };
    }
    const started = live?.stepIndex === stepIndex ? (live.startedAt ?? null) : null;
    return { expectedMillis, startedAt: started, finishedAt: null };
  });
}
