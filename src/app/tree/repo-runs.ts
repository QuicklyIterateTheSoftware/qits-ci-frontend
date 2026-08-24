import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QITS_SCOPE, QitsButton, scopeCommands } from '@qits/ui-components';
import { CI_TRIGGER_TYPES, type CiRunDto, type CiTriggerType } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { formatClock, formatDayTime, formatDuration, shortId, shortSha } from '../ui/format';
import type { Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';
import { TreeNode } from './tree-node';

/**
 * One repository's runs as the tree holds them: the fetch state, plus whether the answer came back
 * full at the limit — which is the only way a client can tell "these are all of them" from "these
 * are the newest hundred", since the listing carries no total.
 */
export interface RunsNode {
  readonly state: Loadable<readonly CiRunDto[]>;
  readonly limited: boolean;
}

/**
 * How many runs a repository asks for when it is expanded.
 *
 * The listing has no paging and no cursor by design, so this is the whole of the strategy: the
 * newest hundred, which is a total answer to "what has this repository been doing", plus a *show
 * all* affordance for the rare case someone wants the history. An offset over a list that grows at
 * the head would re-show rows under concurrent inserts, which is why there is no page two.
 */
export const RUN_PAGE_SIZE = 100;

/** One trigger-type group: what the runs were caused by, and which of them. */
interface RunGroup {
  readonly type: CiTriggerType;
  readonly runs: readonly CiRunDto[];
}

/**
 * What an expanded repository shows: its runs, grouped by what triggered them.
 *
 * The grouping costs **no request**. Every run row already carries `triggerType`, so this is a
 * `groupBy` over a list that has already arrived — which is why a group expands for free, and why a
 * group with no runs is simply not drawn rather than being drawn empty.
 *
 * Group collapse is local state and is deliberately not in the URL: the query parameters carry the
 * two levels that cost a request (Decision 4), and a third parameter for something free would be
 * URL noise. It dies with the node, which is the honest lifetime — a collapsed repository has no
 * groups.
 */
@Component({
  selector: 'app-repo-runs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton, RouterLink, StatusBadge, TreeNode],
  template: `
    <app-async
      [state]="node().state"
      loadingLabel="Loading runs"
      errorLabel="Could not load runs"
      (retry)="reload.emit()"
    />

    @if (node().state; as state) {
      @if (state.kind === 'ready') {
        @if (state.value.length === 0) {
          <app-empty message="No runs recorded for this repository." />
        } @else {
          @for (group of groups(); track group.type) {
            <app-tree-node
              [label]="group.type"
              [meta]="groupMeta(group)"
              [expanded]="isOpen(group.type)"
              (toggled)="toggle(group.type)"
            >
              @if (isOpen(group.type)) {
                <ul class="runs">
                  @for (run of group.runs; track run.id) {
                    <li>
                      <a class="run" [routerLink]="[...home(), 'runs', run.id]">
                        <app-status-badge [status]="run.status" />
                        <code class="run-id">{{ shortId(run.id) }}</code>
                        <span class="branch">{{ run.branch }}</span>
                        <code class="sha">{{ shortSha(run.commitSha) }}</code>
                        <span class="when">
                          {{ formatDayTime(run.createdAt) }} →
                          {{ run.finishedAt ? formatClock(run.finishedAt) : '…' }}
                        </span>
                        <span class="duration">{{ duration(run) }}</span>
                      </a>
                      @if (run.triggerType === 'EVENT') {
                        <p class="provenance">
                          ↳ {{ run.triggerEventName || 'event' }}
                          @if (run.configPath) {
                            · {{ run.configPath }}
                          }
                        </p>
                      }
                    </li>
                  }
                </ul>
              }
            </app-tree-node>
          }
          @if (node().limited) {
            <p class="more">
              <qits-button variant="ghost" size="sm" (pressed)="showAll.emit()">
                show all runs
              </qits-button>
            </p>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .runs {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .run {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      padding: 0.15rem 0.25rem;
      border-radius: 0.25rem;
      color: inherit;
      text-decoration: none;
    }
    .run:hover {
      background: #eef2ff;
    }
    .run:focus-visible {
      outline: 2px solid #4f46e5;
      outline-offset: 1px;
    }
    .run-id,
    .sha {
      color: #4b5563;
    }
    .branch {
      color: #374151;
    }
    .when,
    .duration {
      color: #6b7280;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .duration {
      margin-left: auto;
    }
    .provenance {
      margin: 0 0 0.25rem 2.6rem;
      color: #6b7280;
      font-size: 0.85rem;
    }
    .more {
      margin: 0.25rem 0 0.5rem;
    }
  `,
})
export class RepoRuns {
  private readonly qitsScope = inject(QITS_SCOPE, { optional: true });

  /**
   * The address this application is being read at: `/`, `/qits/` or `/qits/services/qits-ci/`.
   *
   * A run link has to start from it, or following one out of a scoped tree would drop the reader
   * back to the unscoped host. Optional, because this component is also mounted in specs that
   * provide no scope — and unscoped is exactly what `scopeCommands` answers for that.
   */
  protected readonly home = computed<string[]>(() => [...scopeCommands(this.qitsScope?.scope())]);

  /** The repository's runs, exactly as the page holds them. */
  readonly node = input.required<RunsNode>();

  /** Retry the same request — the inline retry on a failed node. */
  readonly reload = output<void>();

  /** Re-fetch without the limit, once the first answer came back full. */
  readonly showAll = output<void>();

  protected readonly shortId = shortId;
  protected readonly shortSha = shortSha;
  protected readonly formatDayTime = formatDayTime;
  protected readonly formatClock = formatClock;

  private readonly now = tickingNow();
  private readonly closed = signal<ReadonlySet<CiTriggerType>>(new Set());

  /** Groups in enum order, and only the ones that have runs. */
  protected readonly groups = computed<readonly RunGroup[]>(() => {
    const state = this.node().state;
    if (state.kind !== 'ready') {
      return [];
    }
    return CI_TRIGGER_TYPES.map((type) => ({
      type,
      runs: state.value.filter((run) => run.triggerType === type),
    })).filter((group) => group.runs.length > 0);
  });

  protected isOpen(type: CiTriggerType): boolean {
    return !this.closed().has(type);
  }

  protected toggle(type: CiTriggerType): void {
    const next = new Set(this.closed());
    if (!next.delete(type)) {
      next.add(type);
    }
    this.closed.set(next);
  }

  /** `12 runs`, and when the answer came back full, that these are only the newest. */
  protected groupMeta(group: RunGroup): string {
    const count = `${group.runs.length} ${group.runs.length === 1 ? 'run' : 'runs'}`;
    return this.node().limited ? `${count} · newest ${RUN_PAGE_SIZE} shown` : count;
  }

  /**
   * A queued run counts from acceptance; once running, its duration restarts at `startedAt`. It is not polled —
   * the tree never polls — so this ticks without asking qits-ci anything.
   */
  protected duration(run: CiRunDto): string {
    const from = run.status === 'QUEUED' ? run.createdAt : run.startedAt;
    return formatDuration(from, run.finishedAt, this.now());
  }
}
