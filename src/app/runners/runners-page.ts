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
import { QitsBadge, QitsButton, type QitsBadgeTone } from '@qits/ui-components';
import { CiApi } from '../api/ci-api';
import type {
  CiRunnerCapabilities,
  CiRunnerCreated,
  CiRunnerDto,
  CiRunnerPlane,
} from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { formatAgo } from '../ui/format';
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
 * The two planes a runner may sit on, in the order they are offered. `EDGE` is first because it is
 * the default: the owner's ruling is that a runner is ordinarily a remote host reaching the platform
 * through its public edge, and `INTERNAL` — on the platform host's own qits-net — is the exception.
 */
const RUNNER_PLANES: readonly CiRunnerPlane[] = ['EDGE', 'INTERNAL'];
const DEFAULT_PLANE: CiRunnerPlane = 'EDGE';

/** What each plane means for where a step's requests go, shown once under the choice. */
const PLANE_EXPLANATIONS: Readonly<Record<CiRunnerPlane, string>> = {
  EDGE: "EDGE: steps on this runner reach the platform through its public names with a job token; the runner needs no platform network.",
  INTERNAL: "INTERNAL: steps use the platform's internal aliases; the runner must be on qits-net.",
};

/** The one sentence shown under a plane choice — both halves, so the reader sees the whole trade-off. */
const PLANE_EXPLANATION = `${PLANE_EXPLANATIONS.EDGE} ${PLANE_EXPLANATIONS.INTERNAL}`;

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

/** The one-time install-script panel: whose it is, and the script itself. */
interface InstallPanel {
  readonly runnerName: string;
  readonly installScript: string;
}

/** A runner's editable fields, held as a draft until saved or discarded. */
interface EditDraft {
  readonly slots: number;
  readonly description: string;
  readonly plane: CiRunnerPlane;
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
  imports: [Async, Empty, QitsBadge, QitsButton],
  templateUrl: './runners-page.html',
  styleUrl: './runners-page.css',
})
export class RunnersPage {
  private readonly api = inject(CiApi);
  private readonly document = inject(DOCUMENT);
  private readonly now = tickingNow();

  protected readonly formatAgo = (iso: string | null) => formatAgo(iso, this.now());
  protected readonly connectivity = connectivityOf;
  protected readonly minSlots = MIN_SLOTS;
  protected readonly maxSlots = MAX_SLOTS;
  protected readonly minEditSlots = MIN_EDIT_SLOTS;
  protected readonly planes = RUNNER_PLANES;
  protected readonly planeExplanation = PLANE_EXPLANATION;

  protected readonly runners = signal<Loadable<readonly CiRunnerDto[]>>(LOADING);

  // --- the create form ---

  protected readonly newName = signal('');
  protected readonly newDescription = signal('');
  protected readonly newSlots = signal(1);
  protected readonly newPlane = signal<CiRunnerPlane>(DEFAULT_PLANE);
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
  protected readonly replacingToken = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');

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
      this.runners.set(ready(await this.api.runners()));
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
      this.runners.set(ready(await this.api.runners()));
    } catch {
      // The last known list stays on screen; a poll that missed once is not worth a banner on a
      // page nobody is watching a build finish from.
    } finally {
      this.inFlight = false;
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
    if (this.nameProblem() || this.slotsProblem()) {
      return;
    }
    this.creating.set(true);
    this.createError.set('');
    try {
      const created = await this.api.createRunner({
        name: this.newName(),
        description: this.newDescription() || null,
        slots: this.newSlots(),
        plane: this.newPlane(),
      });
      this.openInstallPanel(created);
      this.newName.set('');
      this.newDescription.set('');
      this.newSlots.set(1);
      this.newPlane.set(DEFAULT_PLANE);
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
  }

  protected startEdit(runner: CiRunnerDto): void {
    this.editing.set({
      slots: runner.slots,
      description: runner.description ?? '',
      plane: runner.plane,
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

  protected setEditPlane(plane: CiRunnerPlane): void {
    const draft = this.editing();
    if (draft) {
      this.editing.set({ ...draft, plane });
    }
  }

  protected async saveEdit(runner: CiRunnerDto): Promise<void> {
    this.editSubmitted.set(true);
    const draft = this.editing();
    if (!draft || draft.slots < MIN_EDIT_SLOTS || draft.slots > MAX_SLOTS) {
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    try {
      await this.api.patchRunner(runner.id, {
        slots: draft.slots,
        description: draft.description || null,
        plane: draft.plane,
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

  /** Why deletion is refused, client-side, before the server is ever asked. Empty means it is offered. */
  protected deleteBlockedReason(runner: CiRunnerDto): string {
    if (runner.heldRuns === 0) {
      return '';
    }
    return `This runner holds ${runner.heldRuns} run${runner.heldRuns === 1 ? '' : 's'} right now.`;
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
      // The 409 body is the fact that matters — the runner started holding a run between this
      // page's last read and the click — and it is rendered rather than folded into a generic
      // failure sentence.
      this.deleteError.set(describeError(error));
    } finally {
      this.deleting.set(false);
    }
  }
}
