import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CiApi } from '../api/ci-api';
import type { CiRunDto } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { formatDuration, shortSha } from '../ui/format';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/**
 * How often the platform's work in flight is re-read.
 *
 * Ten seconds, and a fixed ten seconds, because this column's cadence is bought against a different
 * cost from the run page's. `GET /ci/api/runs/active` returns a handful of listing rows with no step
 * output at all — kilobytes where a run read is up to 320 KiB — so the traffic argument that made
 * three seconds a compromise there does not apply here. What decides it instead is what the column
 * is *for*: it discovers runs nobody has opened, so its worst case is a run that started and
 * finished inside one interval and was never drawn. Ten seconds keeps that window small while
 * costing an idle platform six tiny requests a minute.
 */
export const ACTIVE_POLL_INTERVAL_MS = 10_000;

/** Whether two sets of run ids hold the same runs — the whole test behind {@link ActiveRuns.changed}. */
function sameIds(before: ReadonlySet<string>, after: ReadonlySet<string>): boolean {
  return before.size === after.size && [...before].every((id) => after.has(id));
}

/**
 * The right rail: every run the platform has QUEUED or RUNNING, whatever repository it belongs to.
 *
 * This is the one thing on either page that is not reached through the tree. The tree answers "what
 * has *this* repository been doing"; nothing in it answers "is anything happening right now", and
 * on a platform where a push in one repository triggers a build in another, that second question is
 * the one an operator arrives with. So the column is deliberately flat, deliberately platform-wide,
 * and deliberately not filtered to what the user has expanded.
 *
 * **It is the one thing here that polls forever.** Decision 5's rule — poll only while a visible
 * entity is non-terminal — reads, for a list whose *contents* are the non-terminal entities, as
 * "poll while the page is open": an empty list is not a reason to stop, because discovering the
 * first run that appears in it is the column's whole job. The rule that does still apply is the one
 * that matters most, and it is enforced the same way as on the run page: a hidden tab reads nothing
 * at all, and coming back is worth one immediate read rather than up to ten seconds of stale screen.
 */
@Component({
  selector: 'app-active-runs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, RouterLink, StatusBadge],
  template: `
    <h2>
      Active runs
      @if (problem()) {
        <span class="stale">· last read failed ({{ problem() }})</span>
      }
    </h2>

    <app-async
      [state]="state()"
      loadingLabel="Loading the runs in flight"
      errorLabel="Could not load the runs in flight"
      (retry)="load()"
    />

    @if (state().kind === 'ready') {
      @if (runs().length === 0) {
        <app-empty message="Nothing building right now." />
      } @else {
        <ul class="active">
          @for (run of runs(); track run.id) {
            <li>
              <a class="entry" [routerLink]="['/runs', run.id]">
                <span class="line">
                  <app-status-badge [status]="run.status" />
                  <span class="repo">{{ run.repoId }}</span>
                </span>
                <span class="line">
                  <code class="ref">{{ run.branch }}&#64;{{ shortSha(run.commitSha) }}</code>
                  <span class="age">{{ age(run) }}</span>
                </span>
              </a>
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    h2 {
      margin: 0 0 0.4rem;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .stale {
      font-weight: 400;
      font-size: 0.8rem;
      color: #b45309;
    }
    .active {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .entry {
      display: block;
      padding: 0.3rem 0.4rem;
      border-radius: 0.25rem;
      color: inherit;
      text-decoration: none;
    }
    .entry:hover {
      background: #eef2ff;
    }
    .entry:focus-visible {
      outline: 2px solid #4f46e5;
      outline-offset: 1px;
    }
    .line {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
    }
    .repo {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ref,
    .age {
      color: #6b7280;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .ref {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .age {
      margin-left: auto;
    }
  `,
})
export class ActiveRuns {
  private readonly api = inject(CiApi);
  private readonly document = inject(DOCUMENT);

  /**
   * The set of runs in flight is not what it was.
   *
   * The rule is the id **set**, not the payload: a poll that finds the same runs with a second more
   * elapsed changes nothing anybody else caches, while a run entering or leaving the set is exactly
   * the moment some repository's newest run became a different run. That is the whole reason the
   * tree can hold its repository summaries still and refresh them on this signal rather than on a
   * timer of its own — one poll pays for both, and a quiet platform pays for neither.
   *
   * The first answer establishes the baseline and emits nothing: the tree read its summaries beside
   * this column's first read, so announcing a change on arrival would only ask for them twice.
   */
  readonly changed = output<void>();

  protected readonly shortSha = shortSha;

  protected readonly state = signal<Loadable<readonly CiRunDto[]>>(LOADING);

  /** A failed *poll* is a note beside the heading; a failed *first* read is the retry above. */
  protected readonly problem = signal('');

  private readonly now = tickingNow();

  /** The ids the last answer held, or null before there has been one. */
  private seen: ReadonlySet<string> | null = null;

  private handle: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  protected readonly runs = computed<readonly CiRunDto[]>(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : [];
  });

  constructor() {
    void this.load();

    const onVisibilityChange = () => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibilityChange);
      this.stop();
    });

    this.sync();
  }

  /** The first read and the retry: this one is allowed to blank the column, because it has none. */
  protected async load(): Promise<void> {
    this.state.set(LOADING);
    this.problem.set('');
    try {
      this.accept(await this.api.activeRuns());
    } catch (error) {
      this.state.set(failed(error));
    }
  }

  /**
   * One poll. A failure leaves the last known list on screen and says so beside the heading —
   * blanking a column of live runs because one request out of six a minute timed out would lose
   * more than it tells.
   */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      this.accept(await this.api.activeRuns());
      this.problem.set('');
    } catch (error) {
      this.problem.set(describeError(error));
    } finally {
      this.inFlight = false;
    }
  }

  private accept(runs: readonly CiRunDto[]): void {
    this.state.set(ready(runs));
    const ids = new Set(runs.map((run) => run.id));
    const before = this.seen;
    this.seen = ids;
    if (before !== null && !sameIds(before, ids)) {
      this.changed.emit();
    }
  }

  private sync(): void {
    if (this.document.hidden) {
      this.stop();
    } else {
      this.handle ??= setInterval(() => void this.poll(), ACTIVE_POLL_INTERVAL_MS);
    }
  }

  private stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  /** A hidden tab reads nothing; coming back reads at once and then hands over to the interval. */
  private onVisibilityChange(): void {
    if (!this.document.hidden) {
      void this.poll();
    }
    this.sync();
  }

  /** `2m 07s ago`, ticked locally against `createdAt` — an age is a subtraction, not a request. */
  protected age(run: CiRunDto): string {
    return `${formatDuration(run.createdAt, null, this.now())} ago`;
  }
}
