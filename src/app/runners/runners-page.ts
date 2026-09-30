import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge, QitsButton, type QitsBadgeTone } from '@qits/ui-components';
import { CiApi } from '../api/ci-api';
import type {
  CiRunnerCapabilities,
  CiRunnerCreated,
  CiRunnerDto,
  CiRunnerHealthcheckDto,
} from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatAgo } from '../ui/format';
import { LOADING, describeError, failed, ready, statusOf, type Loadable } from '../ui/loadable';
import { tickingNow } from '../ui/ticker';

/** How often the runner list is re-read. Ten seconds, the same cadence as the active-runs rail —
 * a runner connecting or dropping is exactly the kind of thing nobody is staring at the screen for. */
export const RUNNERS_POLL_INTERVAL_MS = 10_000;

/**
 * `[a-z][a-z0-9-]{0,63}` — qits-ci's own rule for a runner's name, mirrored here so a bad one is
 * caught before the round trip rather than after it. The server is still the authority: this is a
 * courtesy, not a substitute for its own validation.
 */
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * The name qits-ci registers automatically for the platform host itself, now that every run is held
 * by a runner rather than a built-in in-process executor. It is a runner like any other — it can be
 * edited, health-checked and (once another runner exists) deleted — except that it is drawn first in
 * the list and cannot be deleted while it is the only runner, since deleting it would leave nothing
 * to hold a run.
 */
const LOCALHOST_RUNNER_NAME = 'localhost';

/** localhost first, then alphabetically by name — the same ordering the service itself now applies. */
function sortRunners(runners: readonly CiRunnerDto[]): readonly CiRunnerDto[] {
  return [...runners].sort((a, b) => {
    if (a.name === LOCALHOST_RUNNER_NAME && b.name !== LOCALHOST_RUNNER_NAME) {
      return -1;
    }
    if (b.name === LOCALHOST_RUNNER_NAME && a.name !== LOCALHOST_RUNNER_NAME) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/** The reason shown, client-side, when the platform host's own runner is the only one in the list. */
const LAST_RUNNER_REASON =
  "LAST_RUNNER: the platform host's runner cannot be deleted while it is the only runner";

/**
 * The service's own refusal for the same rule, read off a 409 body the same way
 * {@link edgePlaneUnconfiguredMessage} reads `EDGE_PLANE_UNCONFIGURED` — a `code` field, or the
 * marker inside the message text, whichever the server answers with.
 */
function lastRunnerMessage(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }
  const body = error.error;
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const code = 'code' in body ? (body as { code: unknown }).code : null;
  const message = 'message' in body ? (body as { message: unknown }).message : null;
  const marker = 'LAST_RUNNER';
  const matches = code === marker || (typeof message === 'string' && message.includes(marker));
  return matches ? LAST_RUNNER_REASON : null;
}

/** Slots a single runner may be given on creation. The server's own ceiling; mirrored for the same reason. */
const MIN_SLOTS = 1;
const MAX_SLOTS = 16;

/**
 * Slots an *existing* runner may be edited down to. Unlike creation, the server allows 0 on a
 * PATCH: the runner stays connected and registered, it just takes no new runs. Editing therefore
 * has its own, wider floor rather than reusing {@link MIN_SLOTS}.
 */
const MIN_EDIT_SLOTS = 0;

/**
 * A runner's step memory limit: the runner's own docker-size grammar — digits and an optional
 * `b`/`k`/`m`/`g` — mirrored for {@link NAME_PATTERN}'s reason. The server additionally refuses
 * anything under docker's 6 MiB floor, and its message is rendered when it does.
 */
const STEP_MEMORY_LIMIT_PATTERN = /^[0-9]{1,15}[bkmgBKMG]?$/;

/** Why a typed step memory limit is refused before the round trip, or `''` when it is not. */
function stepMemoryLimitProblemOf(value: string): string {
  const limit = value.trim();
  return limit === '' || STEP_MEMORY_LIMIT_PATTERN.test(limit)
    ? ''
    : 'A docker size: digits and an optional unit b, k, m or g — e.g. 6g or 6144m.';
}

/** What the row says about a runner's step memory: its own cap, or the platform's. */
function stepMemoryDisplayOf(runner: CiRunnerDto): string {
  return runner.stepMemoryLimit ? `${runner.stepMemoryLimit} memory` : 'platform default memory';
}

/**
 * Every runner created here is `EDGE` — the owner's ruling is that a runner is ordinarily a remote
 * host reaching the platform through its public edge, and the backend's other plane, `INTERNAL`, is
 * being retired (qits-513). This client no longer offers a choice, but still sends the literal
 * rather than omitting the field: the server only defaults an absent `plane` to `EDGE` when it knows
 * its own public domain, and falls back to `INTERNAL` otherwise — see the comment on
 * `CreateRunnerRequest` in `api/dto.ts`.
 */
const CREATE_PLANE = 'EDGE';

/** The friendly sentence this page renders instead of the server's own `EDGE_PLANE_UNCONFIGURED`. */
const EDGE_PLANE_UNCONFIGURED_MESSAGE =
  "The platform's public domain is not configured in qits-ci (QITS_DOMAIN).";

/**
 * The one 400 this page gives its own sentence to. The body is the service's usual `{message: …}`
 * error envelope — see `describeError` — so the code is looked for in a `code` field, should the
 * server ever grow one, and in the message text, which is what it answers with today. `null` means
 * this was not that error, and the caller falls back to the generic rendering.
 */
function edgePlaneUnconfiguredMessage(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) {
    return null;
  }
  const body = error.error;
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const code = 'code' in body ? (body as { code: unknown }).code : null;
  const message = 'message' in body ? (body as { message: unknown }).message : null;
  const marker = 'EDGE_PLANE_UNCONFIGURED';
  const matches = code === marker || (typeof message === 'string' && message.includes(marker));
  return matches ? EDGE_PLANE_UNCONFIGURED_MESSAGE : null;
}

/** What the connectivity badge draws, keyed by the three states a runner can be in. */
interface Connectivity {
  readonly label: string;
  readonly tone: QitsBadgeTone;
}

/**
 * The runner's three states, drawn with the same badge vocabulary a run's own status uses —
 * `running`/green for the case that is actually happening now, `queued`/grey for one that exists
 * but is not moving, and a plain grey `never started` for one that has never connected at all. A
 * runner and a run are different entities, but "green means active, grey means not" is the one
 * piece of that vocabulary worth carrying over rather than inventing a second palette for.
 */
function connectivityOf(runner: CiRunnerDto): Connectivity {
  if (runner.connected) {
    return { label: 'running', tone: 'success' };
  }
  if (runner.registered) {
    return { label: 'queued', tone: 'neutral' };
  }
  return { label: 'never started', tone: 'neutral' };
}

/** The sentence shown for a quarantined runner with no reason of its own — a newly registered one. */
const AWAITING_FIRST_HEALTHCHECK = 'awaiting its first health check';

/** The reason shown on a quarantined runner's badge: its own, or the newly-registered default. */
function quarantineReasonOf(runner: CiRunnerDto): string {
  return runner.quarantineReason ?? AWAITING_FIRST_HEALTHCHECK;
}

/** What the last-health-check cell draws, keyed by the check's own result. */
interface HealthcheckDisplay {
  readonly label: string;
  readonly tone: QitsBadgeTone;
  readonly at: string;
  readonly runId: string;
  readonly detail: string | null;
}

/**
 * The last health check's badge, drawn `passed`/success or `failed`/danger — the run it executed
 * as is what the cell links to, so an operator reading "failed" can go straight to why.
 */
function healthcheckDisplay(healthcheck: CiRunnerHealthcheckDto): HealthcheckDisplay {
  const { at, runId, detail } = healthcheck;
  return healthcheck.result === 'PASSED'
    ? { label: 'passed', tone: 'success', at, runId, detail }
    : { label: 'failed', tone: 'danger', at, runId, detail };
}

/** The one-time install-script panel: whose it is, and the script itself. */
interface InstallPanel {
  readonly runnerName: string;
  readonly installScript: string;
}

/** A runner's editable fields, held as a draft until saved or discarded. */
interface EditDraft {
  readonly slots: number;
  readonly description: string;
  /** As typed; blank is the platform default. */
  readonly stepMemoryLimit: string;
}

/**
 * The estate-wide runners page: every runner qits-ci knows about, a form to register a new one,
 * and the one-time install script that registering — or replacing a token — answers.
 *
 * <h2>Why this is not scoped</h2>
 *
 * A runner is infrastructure the whole platform shares, not something one project or repository
 * owns — unlike the tree and the run page, which both answer at three spellings of every address,
 * this page answers at exactly one: `/runners`. See `app.routes.ts`.
 *
 * <h2>The install script is shown once</h2>
 *
 * `POST /ci/api/runners` and `POST /ci/api/runners/{id}/registration-token` both answer a script
 * carrying a single-use token, and this page holds it in exactly one signal — {@link panel} — that
 * exists only while the panel showing it is open. Closing the panel clears the signal; nothing else
 * on this page ever reads it, and nothing persists it. That is the whole of what "shown once" means
 * here: not a server-side restriction this client works around, but a client that does not make the
 * mistake of keeping something the server told it was one-time.
 */
@Component({
  selector: 'app-runners-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsBadge, QitsButton, RouterLink],
  templateUrl: './runners-page.html',
  styleUrl: './runners-page.css',
})
export class RunnersPage {
  private readonly api = inject(CiApi);
  private readonly document = inject(DOCUMENT);
  private readonly now = tickingNow();

  protected readonly formatAgo = (iso: string | null) => formatAgo(iso, this.now());
  protected readonly connectivity = connectivityOf;
  protected readonly quarantineReason = quarantineReasonOf;
  protected readonly stepMemoryDisplay = stepMemoryDisplayOf;
  protected readonly none = NONE;
  protected readonly minSlots = MIN_SLOTS;
  protected readonly maxSlots = MAX_SLOTS;
  protected readonly minEditSlots = MIN_EDIT_SLOTS;

  protected readonly runners = signal<Loadable<readonly CiRunnerDto[]>>(LOADING);

  // --- the create form ---

  protected readonly newName = signal('');
  protected readonly newDescription = signal('');
  protected readonly newSlots = signal(1);
  protected readonly newStepMemoryLimit = signal('');
  protected readonly creating = signal(false);
  protected readonly createError = signal('');

  /** Touched only once a submit was attempted, so an empty field is not an error before anyone typed. */
  private readonly submitted = signal(false);

  protected readonly nameProblem = computed(() => {
    if (!this.submitted()) {
      return '';
    }
    const name = this.newName();
    if (!name) {
      return 'A name is required.';
    }
    return NAME_PATTERN.test(name)
      ? ''
      : 'Lowercase letters, digits and hyphens, starting with a letter.';
  });

  protected readonly slotsProblem = computed(() => {
    if (!this.submitted()) {
      return '';
    }
    const slots = this.newSlots();
    return slots >= MIN_SLOTS && slots <= MAX_SLOTS
      ? ''
      : `Slots must be between ${MIN_SLOTS} and ${MAX_SLOTS}.`;
  });

  protected readonly stepMemoryLimitProblem = computed(() =>
    this.submitted() ? stepMemoryLimitProblemOf(this.newStepMemoryLimit()) : '',
  );

  // --- the once-only install-script panel, shared by creation and by a replaced token ---

  protected readonly panel = signal<InstallPanel | null>(null);
  protected readonly copied = signal(false);
  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- per-row state; only one row's menu is open at a time ---

  protected readonly openRow = signal<string | null>(null);
  protected readonly editing = signal<EditDraft | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');

  /** Touched only once a save was attempted, so the field is not flagged before anyone typed. */
  private readonly editSubmitted = signal(false);

  protected readonly editSlotsProblem = computed(() => {
    const draft = this.editing();
    if (!draft || !this.editSubmitted()) {
      return '';
    }
    return draft.slots >= MIN_EDIT_SLOTS && draft.slots <= MAX_SLOTS
      ? ''
      : `Slots must be between ${MIN_EDIT_SLOTS} and ${MAX_SLOTS}.`;
  });

  protected readonly editStepMemoryLimitProblem = computed(() => {
    const draft = this.editing();
    return draft && this.editSubmitted() ? stepMemoryLimitProblemOf(draft.stepMemoryLimit) : '';
  });
  protected readonly replacingToken = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');

  // --- greenlighting a quarantined runner, and running a health check on demand ---

  protected readonly greenlighting = signal(false);
  protected readonly greenlightError = signal('');
  protected readonly healthcheckError = signal('');

  /**
   * Runner ids with a health check this page itself just queued, mapped to the `lastHealthcheck.at`
   * seen at the moment it was queued — `null` when there was none yet. A row's "Run health check"
   * button stays disabled for exactly as long as its entry survives here.
   *
   * Cleared by comparing against the freshest read rather than by a timer: the button re-enabling
   * means "a newer check landed", and the poll already under way is what answers that, not a clock
   * this page would otherwise have to guess a duration for.
   */
  protected readonly healthchecking = signal<ReadonlyMap<string, string | null>>(new Map());

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor() {
    void this.load();

    const onVisibilityChange = () => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibilityChange);
      this.stopPolling();
      if (this.copiedTimeout !== null) {
        clearTimeout(this.copiedTimeout);
      }
    });

    this.sync();
  }

  protected async load(): Promise<void> {
    this.runners.set(LOADING);
    try {
      const runners = sortRunners(await this.api.runners());
      this.runners.set(ready(runners));
      this.reconcileHealthchecking(runners);
    } catch (error) {
      this.runners.set(failed(error));
    }
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const runners = sortRunners(await this.api.runners());
      this.runners.set(ready(runners));
      this.reconcileHealthchecking(runners);
    } catch {
      // The last known list stays on screen; a poll that missed once is not worth a banner on a
      // page nobody is watching a build finish from.
    } finally {
      this.inFlight = false;
    }
  }

  /** Drops a row's pending health-check flag once a fresher `lastHealthcheck` than the one seen at click time lands, or once the runner is gone. */
  private reconcileHealthchecking(runners: readonly CiRunnerDto[]): void {
    const pending = this.healthchecking();
    if (pending.size === 0) {
      return;
    }
    const byId = new Map(runners.map((runner) => [runner.id, runner] as const));
    const next = new Map(pending);
    let changed = false;
    for (const [id, seenAt] of pending) {
      const runner = byId.get(id);
      const currentAt = runner?.lastHealthcheck?.at ?? null;
      if (!runner || currentAt !== seenAt) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.healthchecking.set(next);
    }
  }

  private sync(): void {
    if (this.document.hidden) {
      this.stopPolling();
    } else {
      this.pollHandle ??= setInterval(() => void this.poll(), RUNNERS_POLL_INTERVAL_MS);
    }
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private onVisibilityChange(): void {
    if (!this.document.hidden) {
      void this.poll();
    }
    this.sync();
  }

  /** Chips for whatever a runner announced. A runner that has never connected announces nothing. */
  protected capabilityChips(capabilities: CiRunnerCapabilities | null): readonly string[] {
    if (!capabilities) {
      return [];
    }
    const chips: string[] = [];
    if (capabilities.docker) {
      chips.push('docker');
    }
    if (capabilities.os) {
      chips.push(capabilities.os);
    }
    if (capabilities.arch) {
      chips.push(capabilities.arch);
    }
    if (capabilities.runnerVersion) {
      chips.push(`v${capabilities.runnerVersion}`);
    }
    for (const [key, value] of Object.entries(capabilities.labels ?? {})) {
      chips.push(`${key}=${value}`);
    }
    return chips;
  }

  // --- creating a runner ---

  protected async createRunner(): Promise<void> {
    this.submitted.set(true);
    if (this.nameProblem() || this.slotsProblem() || this.stepMemoryLimitProblem()) {
      return;
    }
    this.creating.set(true);
    this.createError.set('');
    // Sent only when typed: absent is the platform default, which is what most runners want.
    const stepMemoryLimit = this.newStepMemoryLimit().trim();
    try {
      const created = await this.api.createRunner({
        name: this.newName(),
        description: this.newDescription() || null,
        slots: this.newSlots(),
        plane: CREATE_PLANE,
        ...(stepMemoryLimit ? { stepMemoryLimit } : {}),
      });
      this.openInstallPanel(created);
      this.newName.set('');
      this.newDescription.set('');
      this.newSlots.set(1);
      this.newStepMemoryLimit.set('');
      this.submitted.set(false);
      await this.load();
    } catch (error) {
      const planeMessage = edgePlaneUnconfiguredMessage(error);
      this.createError.set(
        planeMessage ??
          (statusOf(error) === 409
            ? describeError(error)
            : `Could not register this runner — ${describeError(error)}.`),
      );
    } finally {
      this.creating.set(false);
    }
  }

  private openInstallPanel(created: CiRunnerCreated): void {
    this.panel.set({ runnerName: created.name, installScript: created.installScript });
    this.copied.set(false);
  }

  /** Closes the panel and drops the script — nothing on this page holds it anywhere else. */
  protected closePanel(): void {
    this.panel.set(null);
    this.copied.set(false);
  }

  protected async copyInstallScript(): Promise<void> {
    const panel = this.panel();
    if (!panel) {
      return;
    }
    await navigator.clipboard.writeText(panel.installScript);
    this.copied.set(true);
    if (this.copiedTimeout !== null) {
      clearTimeout(this.copiedTimeout);
    }
    this.copiedTimeout = setTimeout(() => this.copied.set(false), 2000);
  }

  // --- the row menu ---

  protected isRowOpen(id: string): boolean {
    return this.openRow() === id;
  }

  protected toggleRow(id: string): void {
    const opening = this.openRow() !== id;
    this.openRow.set(opening ? id : null);
    this.editing.set(null);
    this.saveError.set('');
    this.confirmingDelete.set(false);
    this.deleteError.set('');
    this.greenlightError.set('');
    this.healthcheckError.set('');
  }

  protected startEdit(runner: CiRunnerDto): void {
    this.editing.set({
      slots: runner.slots,
      description: runner.description ?? '',
      stepMemoryLimit: runner.stepMemoryLimit ?? '',
    });
    this.saveError.set('');
    this.editSubmitted.set(false);
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.saveError.set('');
    this.editSubmitted.set(false);
  }

  protected setEditSlots(slots: number): void {
    const draft = this.editing();
    if (draft) {
      this.editing.set({ ...draft, slots });
    }
  }

  protected setEditDescription(description: string): void {
    const draft = this.editing();
    if (draft) {
      this.editing.set({ ...draft, description });
    }
  }

  protected setEditStepMemoryLimit(stepMemoryLimit: string): void {
    const draft = this.editing();
    if (draft) {
      this.editing.set({ ...draft, stepMemoryLimit });
    }
  }

  protected async saveEdit(runner: CiRunnerDto): Promise<void> {
    this.editSubmitted.set(true);
    const draft = this.editing();
    if (
      !draft ||
      draft.slots < MIN_EDIT_SLOTS ||
      draft.slots > MAX_SLOTS ||
      stepMemoryLimitProblemOf(draft.stepMemoryLimit)
    ) {
      return;
    }
    // Sent only when it moved — an empty string is the clear, back to the platform default.
    const stepMemoryLimit = draft.stepMemoryLimit.trim();
    const memoryChanged = stepMemoryLimit !== (runner.stepMemoryLimit ?? '');
    this.saving.set(true);
    this.saveError.set('');
    try {
      await this.api.patchRunner(runner.id, {
        slots: draft.slots,
        description: draft.description || null,
        ...(memoryChanged ? { stepMemoryLimit } : {}),
      });
      this.editing.set(null);
      await this.load();
    } catch (error) {
      const planeMessage = edgePlaneUnconfiguredMessage(error);
      this.saveError.set(planeMessage ?? `Could not save — ${describeError(error)}.`);
    } finally {
      this.saving.set(false);
    }
  }

  protected async replaceToken(runner: CiRunnerDto): Promise<void> {
    this.replacingToken.set(true);
    try {
      this.openInstallPanel(await this.api.replaceRegistrationToken(runner.id));
      this.openRow.set(null);
    } catch (error) {
      this.saveError.set(`Could not replace the registration token — ${describeError(error)}.`);
    } finally {
      this.replacingToken.set(false);
    }
  }

  /** Whether this is the runner qits-ci registers automatically for the platform host itself. */
  protected isPlatformHost(runner: CiRunnerDto): boolean {
    return runner.name === LOCALHOST_RUNNER_NAME;
  }

  /** Why deletion is refused, client-side, before the server is ever asked. Empty means it is offered. */
  protected deleteBlockedReason(runner: CiRunnerDto): string {
    if (runner.heldRuns > 0) {
      return `This runner holds ${runner.heldRuns} run${runner.heldRuns === 1 ? '' : 's'} right now.`;
    }
    const state = this.runners();
    const allRunners = state.kind === 'ready' ? state.value : [];
    if (this.isPlatformHost(runner) && allRunners.length <= 1) {
      return LAST_RUNNER_REASON;
    }
    return '';
  }

  protected askDelete(): void {
    this.confirmingDelete.set(true);
  }

  protected dismissDelete(): void {
    this.confirmingDelete.set(false);
  }

  protected async confirmDelete(runner: CiRunnerDto): Promise<void> {
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await this.api.deleteRunner(runner.id);
      this.openRow.set(null);
      this.confirmingDelete.set(false);
      await this.load();
    } catch (error) {
      // The 409 body is the fact that matters — either the runner started holding a run between
      // this page's last read and the click, or the server caught LAST_RUNNER a beat before this
      // page's own client-side check would have — and it is rendered rather than folded into a
      // generic failure sentence.
      this.deleteError.set(lastRunnerMessage(error) ?? describeError(error));
    } finally {
      this.deleting.set(false);
    }
  }

  // --- quarantine: the badge and the "since", and the two actions the row menu offers ---

  /** Slots as the row shows them: the configured ceiling normally, `0 (of N)` while quarantined. */
  protected slotsDisplay(runner: CiRunnerDto): string {
    return runner.quarantined ? `0 (of ${runner.slots})` : `${runner.slots} slots`;
  }

  /** What the last-health-check cell draws, or `null` for a runner with no check on record yet. */
  protected healthcheck(runner: CiRunnerDto): HealthcheckDisplay | null {
    return runner.lastHealthcheck ? healthcheckDisplay(runner.lastHealthcheck) : null;
  }

  protected isHealthchecking(runner: CiRunnerDto): boolean {
    return this.healthchecking().has(runner.id);
  }

  /** Confirm-less: a runner already stuck in quarantine is the thing being fixed, not risked. */
  protected async greenlightRunner(runner: CiRunnerDto): Promise<void> {
    this.greenlighting.set(true);
    this.greenlightError.set('');
    try {
      await this.api.greenlightRunner(runner.id);
      await this.load();
    } catch (error) {
      this.greenlightError.set(`Could not greenlight this runner — ${describeError(error)}.`);
    } finally {
      this.greenlighting.set(false);
    }
  }

  protected async runHealthcheck(runner: CiRunnerDto): Promise<void> {
    if (this.isHealthchecking(runner)) {
      return;
    }
    this.healthcheckError.set('');
    this.healthchecking.update((map) => new Map(map).set(runner.id, runner.lastHealthcheck?.at ?? null));
    try {
      await this.api.runRunnerHealthcheck(runner.id);
      await this.load();
    } catch (error) {
      // A 409 means one is already queued or running for this runner — that fact, not a generic
      // failure, and the button re-enables since nothing new was queued by this click.
      this.healthcheckError.set(`Could not run a health check — ${describeError(error)}.`);
      this.healthchecking.update((map) => {
        const next = new Map(map);
        next.delete(runner.id);
        return next;
      });
    }
  }
}
