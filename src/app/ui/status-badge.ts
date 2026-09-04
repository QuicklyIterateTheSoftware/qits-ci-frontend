import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge, type QitsBadgeTone } from '@qits/ui-components';

/**
 * A run's or a step's status, in the platform's badge.
 *
 * The map is the whole component, and it lives here rather than in each template so that "what
 * colour is CONFIG_ERROR" is answered once. `QitsBadge` takes a *semantic* tone and never a colour,
 * so this is a translation between two vocabularies, not styling.
 *
 * One map covers both enums because they overlap and never collide: `SUCCESS` and `FAILED` mean the
 * same thing on a run and on a step, and `SKIPPED` only ever appears on a step. `TIMED_OUT` is
 * `danger` too — a step that ran out of its deadline is a red outcome, like a step that failed.
 *
 * `QUEUED` is `neutral` on purpose. A queued run has produced no outcome at all — nothing has gone
 * right, nothing has gone wrong, and nothing is even happening yet — so it reads as the absence of
 * news, while `RUNNING` keeps `info` for the one state where something is actually moving. It is
 * also the tone the platform's design register already gives a queued *deployment*, and a status
 * word that changed colour between the two services would be a distinction without a difference.
 *
 * `CANCELLED` is `neutral` for a sharper version of the same reason, and it is the one entry here
 * worth defending: a stopped run is <b>not a verdict</b>. qits-ci publishes no build event for it at
 * all, so nothing downstream is gated on it and painting it `danger` beside a genuine `FAILED` would
 * claim a red this platform never recorded. What the badge cannot carry — that no verdict was
 * published, so re-running is the next move — the run page says in words beside it.
 */
const TONES: Readonly<Record<string, QitsBadgeTone>> = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  SUCCESS: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  CONFIG_ERROR: 'warning',
  TIMED_OUT: 'danger',
  SKIPPED: 'neutral',
  PENDING: 'neutral',
};

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge],
  template: `<qits-badge [label]="status()" [tone]="tone()" />`,
})
export class StatusBadge {
  readonly status = input.required<string>();

  /**
   * `neutral` for a status this build has not been taught. A new enum value must render as a plain
   * badge rather than crash or silently claim success.
   */
  protected readonly tone = computed<QitsBadgeTone>(() => TONES[this.status()] ?? 'neutral');
}
