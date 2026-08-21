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
import { formatDayTime, formatDuration, runRepositoryLabel, shortSha } from '../ui/format';
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
 * is *for*: it discovers runs nobody has opened.
 *
 * **Its old worst case is gone.** A run that started and finished inside one interval used to be
 * drawn nowhere at all — it was never in an answer this column read. The finished listing is polled
 * on the same tick now, so such a run is not missed, it simply arrives already over. What ten
 * seconds still costs is the *liveness* of a run seen while it runs, and an idle platform pays
 * twelve tiny requests a minute for it.
 */
export const ACTIVE_POLL_INTERVAL_MS = 10_000;

/**
 * How many finished runs the stack is seeded with when the view opens.
 *
 * It is also what each poll asks for, and that second use is the one with a bound to justify. A
 * Five is a compact recent-history window rather than a claim about server throughput: build
 * concurrency is deployment-configurable. The server caps the parameter at a hundred either way.
 */
export const FINISHED_SEED_COUNT = 5;

/** Whether two sets of run ids hold the same runs — the whole test behind {@link ActiveRuns.changed}. */
function sameIds(before: ReadonlySet<string>, after: ReadonlySet<string>): boolean {
  return before.size === after.size && [...before].every((id) => after.has(id));
}

/**
 * Whether one finished run is newer than another, in the server's own total order: `finishedAt`
 * first, the id
 * as the tie-break.
 *
 * The instants are **parsed rather than compared as strings**. `Instant` serialises with as many
 * fractional digits as it has, so `…:00Z` and `…:00.5Z` are half a second apart and sort the wrong
 * way lexicographically — `.` is below `Z`. Parsing costs nothing here and is right whatever
 * precision the server sends.
 */
function isNewer(run: CiRunDto, than: CiRunDto): boolean {
  const at = Date.parse(run.finishedAt ?? '');
  const other = Date.parse(than.finishedAt ?? '');
  return at === other ? run.id > than.id : at > other;
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
 *
 * <h2>The finished stack above it</h2>
 *
 * The rail draws a second list on top: the runs that are **over**, oldest at the top and newest at
 * the bottom, so it grows downwards into the active list and reads as a timeline running into the
 * present. It is seeded with the newest {@link FINISHED_SEED_COUNT} from `GET
 * /ci/api/runs/finished` and then **appended to and never trimmed** for as long as the view is
 * open — five rows become six, then seven. A reload starts again at five, which is the only place
 * the number reappears.
 *
 * **Append-only is the whole design, not an optimisation.** A rail that re-seeded on every poll
 * would silently drop the run an operator was watching a moment ago, exactly when a burst of builds
 * made the history worth having. Growing without bound is bounded in practice by how long a tab
 * stays open, which is the user's decision rather than this component's to make for them.
 *
 * **One poll feeds both lists**, and that is what makes completion detection free: a run that
 * leaves the active listing has finished, and the same tick's finished listing is where it turns
 * up. There is no per-run read, no id bookkeeping against the run page, and — because the finished
 * listing is answered independently of whether this client ever saw the run active — a run that
 * started *and* finished between two ticks still lands in the stack. That case used to be invisible.
 */
@Component({
  selector: 'app-active-runs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, RouterLink, StatusBadge],
  template: `
    @if (finished().length > 0) {
      <h2>Finished runs</h2>
      <ul class="stack">
        @for (run of finished(); track run.id) {
          <li>
            <a class="entry" [routerLink]="['/runs', run.id]">
              <span class="line">
                <app-status-badge [status]="run.status" />
                <span class="repo">{{ repoLabel(run) }}</span>
              </span>
              <span class="line">
                <code class="ref">{{ run.branch }}&#64;{{ shortSha(run.commitSha) }}</code>
                <span class="age">{{ formatDayTime(run.finishedAt) }}</span>
              </span>
            </a>
          </li>
        }
      </ul>
    }

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
                  <span class="repo">{{ repoLabel(run) }}</span>
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
    /* The finished stack reads as past: a timeline rule down its left edge, and its own text muted
       so the status badges — which carry the outcome and are the reason to look — stay the only
       saturated thing in it. The row structure is deliberately identical to an active row, because
       these are the same entity in a different tense. */
    .stack {
      list-style: none;
      margin: 0 0 1rem;
      padding: 0 0 0 0.5rem;
      border-left: 2px solid #e5e7eb;
    }
    .stack .repo,
    .stack .ref,
    .stack .age {
      color: #9ca3af;
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
   *
   * **A run appended to the finished stack counts as a change too**, and it has to: a run that
   * started and finished between two polls never entered or left the active set, so the id-set test
   * alone would leave the tree's badges reporting a run that is no longer that repository's newest.
   * At most one emission per poll whatever moved, so the ordinary case — a run leaving the active
   * list and arriving in the stack on the same tick — still costs the tree one refresh.
   */
  readonly changed = output<void>();

  protected readonly shortSha = shortSha;
  protected readonly repoLabel = runRepositoryLabel;
  protected readonly formatDayTime = formatDayTime;

  protected readonly state = signal<Loadable<readonly CiRunDto[]>>(LOADING);

  /**
   * The runs that are over, **oldest first** — the order they are drawn in, and the order they were
   * appended in. Never trimmed while this component lives.
   */
  protected readonly finished = signal<readonly CiRunDto[]>([]);

  /** Every id in the stack, so a run is appended at most once however often a poll re-reports it. */
  private stacked = new Set<string>();

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
      this.accept(...(await this.read()));
    } catch (error) {
      this.state.set(failed(error));
    }
  }

  /**
   * One poll. A failure leaves the last known list on screen and says so beside the heading —
   * blanking a column of live runs because one request out of twelve a minute timed out would lose
   * more than it tells.
   */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      this.accept(...(await this.read()));
      this.problem.set('');
    } catch (error) {
      this.problem.set(describeError(error));
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Both listings, on one tick and in parallel.
   *
   * They are two requests rather than one because they are two questions the server answers
   * separately, and issuing them together is what makes "this run left the active list and this run
   * arrived in the stack" one instant rather than two. The active read is the one allowed to fail
   * the whole poll: it is this column's content, while the finished stack is history that keeps
   * whatever it already has. So a finished read that fails yields `null` and changes nothing.
   */
  private async read(): Promise<[readonly CiRunDto[], readonly CiRunDto[] | null]> {
    const [active, finished] = await Promise.all([
      this.api.activeRuns(),
      this.api.finishedRuns(FINISHED_SEED_COUNT).catch(() => null),
    ]);
    return [active, finished];
  }

  private accept(active: readonly CiRunDto[], finished: readonly CiRunDto[] | null): void {
    const before = this.seen;
    this.state.set(ready(active));
    const ids = new Set(active.map((run) => run.id));
    this.seen = ids;

    // The first answer seeds the stack; every later one may only add to it. The two are the same
    // moment for both lists, which is what keeps a fresh open at exactly five rows.
    let appended = false;
    if (finished !== null) {
      if (before === null && this.stacked.size === 0) {
        this.seed(finished);
      } else {
        appended = this.absorb(finished);
      }
    }

    if (before !== null && (!sameIds(before, ids) || appended)) {
      this.changed.emit();
    }
  }

  /** The newest five, reversed: the server answers newest first, the stack reads oldest first. */
  private seed(runs: readonly CiRunDto[]): void {
    const oldestFirst = [...runs].reverse();
    this.stacked = new Set(oldestFirst.map((run) => run.id));
    this.finished.set(oldestFirst);
  }

  /**
   * Append whatever finished since the last poll, and nothing else.
   *
   * Two filters, and both are load-bearing. **The id** keeps a run out that is already in the stack,
   * which every poll re-reports for as long as it stays in the server's newest five. **Being newer
   * than the bottom row** is what keeps the stack chronological: a run that started before the
   * bottom one and finished after it is genuinely new to this client, but appending it would put an
   * older `finishedAt` below a newer one and break the timeline the column is drawing. It is dropped
   * rather than inserted, because inserting it would move rows the user has already read.
   */
  private absorb(runs: readonly CiRunDto[]): boolean {
    const stack = this.finished();
    const newest = stack.length > 0 ? stack[stack.length - 1] : null;
    const arrivals = runs
      .filter((run) => !this.stacked.has(run.id))
      .filter((run) => newest === null || isNewer(run, newest))
      .sort((one, other) => (isNewer(one, other) ? 1 : -1));
    if (arrivals.length === 0) {
      return false;
    }
    for (const run of arrivals) {
      this.stacked.add(run.id);
    }
    this.finished.set([...stack, ...arrivals]);
    return true;
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

  /** Queue age until claimed; execution age restarts from the worker's start timestamp. */
  protected age(run: CiRunDto): string {
    if (run.status === 'QUEUED') {
      return `queued for ${formatDuration(run.createdAt, null, this.now())}`;
    }
    return `running for ${formatDuration(run.startedAt, null, this.now())}`;
  }
}
