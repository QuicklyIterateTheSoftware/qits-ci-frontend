import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CiRunDto } from '../api/dto';
import { formatDuration } from './format';
import { tickingNow } from './ticker';

/**
 * What the bar reads off a run, and the whole of it: the shape the pipeline is expected to take, and
 * where the run currently is inside that shape.
 *
 * A `Pick` rather than a whole `CiRunDto` because every caller has one of those anyway and none of
 * them has to build one — the listings, the tree rows and the run page all pass the run they already
 * hold.
 */
export type ExpectedProgressRun = Pick<
  CiRunDto,
  'status' | 'startedAt' | 'expectedStepDurationsMillis'
>;

/**
 * The gap between two steps, in percent **of the whole track** rather than of the segment it is
 * carved out of.
 *
 * A constant slice of the bar is what makes the boundaries read as boundaries: a gap proportional to
 * its step would be invisible on a short one and a canyon on a long one, and the thing being drawn
 * is "here is where step 2 begins", which is the same statement whatever the steps cost.
 */
export const STEP_GAP_PERCENT = 1;

/**
 * One step's slice of the track, in percent.
 *
 * `left` and `width` place it; `fill` is how much of *that slice* is done, as a percent of the
 * slice's own width, so the segment paints itself and nothing is overlaid across the gaps.
 */
export interface ProgressSegment {
  readonly left: number;
  readonly width: number;
  readonly fill: number;
}

/** Two decimals is more precision than a pixel can carry, and keeps a style attribute readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * How long the whole pipeline is expected to take, or null when there is nothing to predict from.
 *
 * Null covers absence and nonsense alike — no field, an empty list, or an entry that is not a
 * positive number — because every caller does the same thing with all of them: render exactly what
 * it rendered before expectations existed. A partial prediction is worse than none: the bar's
 * segments are shares of this total, so one bad entry would move every other step's boundary.
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
 * Whether this run predicts anything at all — the exact question {@link ExpectedProgress} answers by
 * drawing nothing, exposed so a caller can leave out the surrounding layout as well.
 *
 * The component is safe to mount either way; this is for the margins and table cells around it,
 * which would otherwise be spacing for an element that drew nothing.
 */
export function hasExpectations(run: ExpectedProgressRun): boolean {
  return totalExpectedMillis(run.expectedStepDurationsMillis) !== null;
}

/**
 * The expected shape of a run, as a bar it fills up while it runs.
 *
 * The track is divided **per step**, each segment as wide as that step's share of the total the
 * pipeline is expected to take, so the bar says two things at once: how far along the run is, and
 * which step it is in. That second reading is the reason this is not one plain progress bar — "70%
 * done" is a number, "most of the way through the long test step" is an answer.
 *
 * The prediction is a p95 of the same step in the same pipeline, so it is a shape rather than a
 * promise. A run that outlasts it is not late in any sense the platform enforces: the bar stays full
 * and shifts tone, which is a statement that the run is taking longer than its history and nothing
 * more. It never grows past the end, because a bar that could exceed its own track would have to
 * rescale itself and no reader can compare two frames of that.
 *
 * A `QUEUED` run draws the empty track: it has the shape, and it has not started. Nothing here polls
 * — the fill and the number beside it are a subtraction against {@link tickingNow}, the same way
 * every other duration on these screens moves without asking qits-ci anything.
 *
 * Drawn only where there is something to draw: a run with no expectations renders **nothing at all**,
 * so every caller can mount it unconditionally and a run from before this field existed looks
 * exactly as it did.
 */
@Component({
  selector: 'app-expected-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (segments().length > 0) {
      <div class="row">
        <div
          class="track"
          role="progressbar"
          aria-label="Progress against the expected duration"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="percent()"
        >
          @for (segment of segments(); track $index) {
            <span class="segment" [style.left.%]="segment.left" [style.width.%]="segment.width">
              <span class="fill" [class.overdue]="overdue()" [style.width.%]="segment.fill"></span>
            </span>
          }
        </div>
        @if (elapsed()) {
          <span class="elapsed" [class.overdue]="overdue()">{{ elapsed() }}</span>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    /* The track carries no colour of its own: the segments are the empty tone, so a gap is a gap
       rather than a lighter piece of bar, and the fill never has to be masked across one. */
    .track {
      position: relative;
      flex: 1;
      min-width: 2rem;
      height: 0.3rem;
    }
    .segment {
      position: absolute;
      top: 0;
      bottom: 0;
      overflow: hidden;
      border-radius: 999px;
      background: #e5e7eb;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: #2563eb;
    }
    /* Taking longer than its own history is not a failure, so it is not red: the amber this
       application already uses for "something is off, nothing is broken" says it without shouting. */
    .fill.overdue {
      background: #b45309;
    }
    .elapsed {
      color: #6b7280;
      font-size: 0.85rem;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .elapsed.overdue {
      color: #b45309;
    }
  `,
})
export class ExpectedProgress {
  readonly run = input.required<ExpectedProgressRun>();

  private readonly now = tickingNow();

  /** What the whole pipeline is expected to cost, or null when this run predicts nothing. */
  protected readonly total = computed(() =>
    totalExpectedMillis(this.run().expectedStepDurationsMillis),
  );

  /**
   * How long the run has actually been going.
   *
   * `RUNNING` only. A queued run has not started — there is no `startedAt` to subtract from and its
   * wait is not progress through the pipeline — and a finished one is history the caller renders
   * from its own timestamps.
   */
  protected readonly elapsedMillis = computed(() => {
    const run = this.run();
    if (run.status !== 'RUNNING' || !run.startedAt) {
      return 0;
    }
    const started = Date.parse(run.startedAt);
    return Number.isNaN(started) ? 0 : Math.max(0, this.now() - started);
  });

  /** Clamped at both ends: a bar cannot be less than empty, and it must not outgrow its track. */
  protected readonly progress = computed(() => {
    const total = this.total();
    if (total === null) {
      return 0;
    }
    return Math.min(1, Math.max(0, this.elapsedMillis() / total));
  });

  protected readonly percent = computed(() => Math.round(this.progress() * 100));

  /** Past its own p95. The bar is already full, so this is the only thing left to say. */
  protected readonly overdue = computed(() => {
    const total = this.total();
    return total !== null && this.elapsedMillis() > total;
  });

  /**
   * The segments, left to right.
   *
   * Each step gets its **share** of the track, and every segment but the last gives the gap back out
   * of its own width — so the boundaries land where the steps actually change rather than drifting
   * right by one gap per step. Two steps of 10s and 90s are drawn 9%, a 1% gap, then 90%.
   *
   * A step so short that its share is under the gap clamps to zero width rather than a negative one.
   * It keeps its place in the layout — `left` still advances by the full share — because the point of
   * the division is where the *other* boundaries are.
   *
   * The fill within a segment is measured against the share and not the drawn width, which is what
   * makes a segment read as complete exactly when its step's expected end passes rather than a gap's
   * worth of time early.
   */
  protected readonly segments = computed<readonly ProgressSegment[]>(() => {
    const expected = this.run().expectedStepDurationsMillis;
    const total = this.total();
    if (!expected || total === null) {
      return [];
    }
    const done = this.progress() * 100;
    const segments: ProgressSegment[] = [];
    let left = 0;
    for (const [index, step] of expected.entries()) {
      const share = (step / total) * 100;
      const last = index === expected.length - 1;
      segments.push({
        left: round(left),
        width: round(last ? share : Math.max(0, share - STEP_GAP_PERCENT)),
        fill: round(Math.min(100, Math.max(0, ((done - left) / share) * 100))),
      });
      left += share;
    }
    return segments;
  });

  /** The time actually taken, ticking. Empty while there is no execution to measure. */
  protected readonly elapsed = computed(() => {
    const run = this.run();
    if (run.status !== 'RUNNING' || !run.startedAt) {
      return '';
    }
    return formatDuration(run.startedAt, null, this.now());
  });
}
