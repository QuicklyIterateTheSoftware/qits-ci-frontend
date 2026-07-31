import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { CiApi } from '../api/ci-api';
import { isTerminal, type CiRunDto, type CiStepDto } from '../api/dto';
import { Async } from '../ui/async';
import {
  NONE,
  formatClock,
  formatDuration,
  formatElapsed,
  formatInstant,
  shortSha,
  stripAnsi,
} from '../ui/format';
import { LOADING, describeError, failed, ready, statusOf, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/**
 * How often a RUNNING run is re-read.
 *
 * Three seconds rather than one is bought with a measured cost. The run read has no delta and no
 * offset: every poll re-sends the full `output` of every completed step, each bounded at
 * `qits.ci.output-max-chars=65536`, so a five-step run is up to 320 KiB per poll. A conditional GET
 * would save nothing during the window that matters — the resource genuinely changes every second
 * while a run is running — so the honest lever is the cadence, and the fix is an output offset on
 * the server, named as a fast-follow rather than worked around here.
 */
export const POLL_INTERVAL_MS = 3000;

@Component({
  selector: 'app-run-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsButton, RouterLink, StatusBadge],
  templateUrl: './run-page.html',
  styleUrl: './run-page.css',
})
export class RunPage {
  private readonly api = inject(CiApi);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  protected readonly formatInstant = formatInstant;
  protected readonly formatClock = formatClock;
  protected readonly shortSha = shortSha;
  protected readonly stripAnsi = stripAnsi;
  protected readonly none = NONE;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  /** The run's real identity, and the whole path — a run knows nothing about projects. */
  protected readonly runId = computed(() => this.params().get('runId') ?? '');

  protected readonly run = signal<Loadable<CiRunDto>>(LOADING);

  /** When the last answer arrived, so “updated 2s ago” is measured rather than claimed. */
  private readonly updatedAt = signal(0);

  /** When this client first saw the current live step — the relay carries no timestamps. */
  private readonly liveSince = signal(0);

  private readonly now = tickingNow();

  /** A failed poll leaves the last good run on screen and says so; it does not blank the page. */
  protected readonly pollProblem = signal('');

  private readonly openSteps = signal<ReadonlySet<number>>(new Set());
  private stepsInitialised = false;
  protected readonly liveOpen = signal(true);

  protected readonly confirming = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly cancelNote = signal('');

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  /** A run id that resolves to nothing is a rendered sentence, not a crash. */
  protected readonly missing = computed(() => {
    const state = this.run();
    return state.kind === 'error' && state.status === 404;
  });

  protected readonly value = computed(() => {
    const state = this.run();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly running = computed(() => {
    const run = this.value();
    return run !== null && !isTerminal(run.status);
  });

  protected readonly steps = computed<readonly CiStepDto[]>(() => this.value()?.steps ?? []);

  /** `updated 2s ago`, and only while there is something to follow. */
  protected readonly followedFor = computed(() => {
    const updated = this.updatedAt();
    return updated === 0 ? '' : formatElapsed(this.now() - updated);
  });

  constructor() {
    // The id comes from the URL, so a navigation between two runs must reset everything the old
    // one owned — including which step panes were open.
    effect(() => {
      const runId = this.runId();
      this.reset();
      if (runId) {
        void this.load(runId);
      }
    });

    const onVisibilityChange = () => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibilityChange);
      this.stopPolling();
    });
  }

  private reset(): void {
    this.stopPolling();
    this.run.set(LOADING);
    this.updatedAt.set(0);
    this.liveSince.set(0);
    this.pollProblem.set('');
    this.cancelNote.set('');
    this.confirming.set(false);
    this.openSteps.set(new Set());
    this.stepsInitialised = false;
  }

  /** The first read, and the one the retry re-issues. A single request; it needs no ancestors. */
  protected async load(runId = this.runId()): Promise<void> {
    this.run.set(LOADING);
    try {
      this.accept(await this.api.run(runId));
    } catch (error) {
      this.run.set(failed(error));
    }
    this.syncPolling();
  }

  /**
   * One poll. A failure here is reported beside the run rather than replacing it: the run on screen
   * is still the last thing the server said, and blanking it because one request out of a hundred
   * timed out would lose more than it tells.
   */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      this.accept(await this.api.run(this.runId()));
      this.pollProblem.set('');
    } catch (error) {
      this.pollProblem.set(describeError(error));
    } finally {
      this.inFlight = false;
      this.syncPolling();
    }
  }

  private accept(run: CiRunDto): void {
    const previous = this.value();
    this.run.set(ready(run));
    this.updatedAt.set(Date.now());
    if (run.live && run.live.stepIndex !== previous?.live?.stepIndex) {
      this.liveSince.set(Date.now());
    }
    if (!this.stepsInitialised && run.steps) {
      // The last completed step is the one worth reading on arrival; everything above it is
      // history, and while a run is going the live pane is the interesting one anyway.
      const last = run.steps.at(-1);
      this.openSteps.set(new Set(last ? [last.stepIndex] : []));
      this.stepsInitialised = true;
    }
  }

  /**
   * Poll only while a visible entity is non-terminal. Terminal means stop, and stop for good: the
   * terminal response is already complete — `live` is null and unreached steps are written
   * `SKIPPED` — so there is nothing a further read could add.
   */
  private shouldPoll(): boolean {
    return this.running() && !this.document.hidden;
  }

  private syncPolling(): void {
    if (this.shouldPoll()) {
      this.pollHandle ??= setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    } else {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /**
   * A hidden tab polls nothing. Coming back is worth one immediate read rather than up to three
   * seconds of stale screen, and then the interval takes over again.
   */
  private onVisibilityChange(): void {
    if (this.shouldPoll()) {
      void this.poll();
    }
    this.syncPolling();
  }

  protected isStepOpen(stepIndex: number): boolean {
    return this.openSteps().has(stepIndex);
  }

  protected toggleStep(stepIndex: number): void {
    const next = new Set(this.openSteps());
    if (!next.delete(stepIndex)) {
      next.add(stepIndex);
    }
    this.openSteps.set(next);
  }

  protected toggleLive(): void {
    this.liveOpen.update((open) => !open);
  }

  protected stepDuration(step: CiStepDto): string {
    return formatDuration(step.startedAt, step.finishedAt);
  }

  protected runDuration(run: CiRunDto): string {
    return formatDuration(run.createdAt, run.finishedAt, this.now());
  }

  /** The live step has no timestamps at all, so its elapsed time is this client's measurement. */
  protected liveElapsed(): string {
    const since = this.liveSince();
    return since === 0 ? NONE : formatElapsed(this.now() - since);
  }

  protected askCancel(): void {
    this.confirming.set(true);
  }

  protected dismissCancel(): void {
    this.confirming.set(false);
  }

  /**
   * The page's one write, and the only operation qits-ci publishes for a person.
   *
   * A 409 is not an error to report: it means the run finished between the render and the click,
   * which is a race the server is right to refuse and the client is right to shrug at. Either way
   * the next read is the truth, so both paths end in a poll and the button disappears when the run
   * turns terminal — the state is reconciled, never assumed.
   */
  protected async confirmCancel(): Promise<void> {
    const run = this.value();
    if (!run) {
      return;
    }
    this.cancelling.set(true);
    this.cancelNote.set('');
    try {
      await this.api.cancel(run.id);
      this.cancelNote.set('Cancelling — the run stops once its container answers.');
    } catch (error) {
      this.cancelNote.set(
        statusOf(error) === 409
          ? 'This run had already finished, so there was nothing to stop.'
          : `Could not cancel this run — ${describeError(error)}.`,
      );
    } finally {
      this.cancelling.set(false);
      this.confirming.set(false);
      await this.poll();
    }
  }
}
