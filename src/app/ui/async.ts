import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import type { Loadable } from './loadable';

/**
 * The two states a caller should never hand-roll: waiting, and failed-with-a-way-back.
 *
 * It renders *nothing* when the state is ready or idle, and the caller renders the content itself
 * behind its own `@if`. That is deliberate rather than a projection slot: `<ng-content>` inside a
 * conditional block would be instantiated by this component's template, so the caller could not
 * keep a collapsed node's children out of the DOM — and a node that builds its children while
 * collapsed is exactly the eager fan-out Decision 3 exists to avoid.
 *
 * The retry is an output, not a callback input: the caller owns the request and this owns the
 * button.
 */
@Component({
  selector: 'app-async',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    @switch (state().kind) {
      @case ('loading') {
        <p class="async async-loading" role="status">
          <span class="bar" aria-hidden="true"></span>
          <span class="sr">{{ loadingLabel() }}</span>
        </p>
      }
      @case ('error') {
        <p class="async async-error" role="alert">
          <span>⚠ {{ errorLabel() }} — {{ message() }}.</span>
          <qits-button variant="ghost" size="sm" (pressed)="retry.emit()">Retry</qits-button>
        </p>
      }
    }
  `,
  styles: `
    .async {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.15rem 0;
      min-height: 1.6rem;
    }
    .async-error {
      color: #b91c1c;
    }
    .bar {
      display: block;
      width: 12rem;
      max-width: 60%;
      height: 0.7rem;
      border-radius: 0.35rem;
      background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
      background-size: 200% 100%;
      animation: async-shimmer 1.2s linear infinite;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @keyframes async-shimmer {
      from {
        background-position: 200% 0;
      }
      to {
        background-position: -200% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bar {
        animation: none;
      }
    }
  `,
})
export class Async {
  /** The node's own state. Ready and idle draw nothing here. */
  readonly state = input.required<Loadable<unknown>>();

  /** What is being waited for, announced to a screen reader rather than shown. */
  readonly loadingLabel = input('Loading');

  /** What failed, in the caller's words: “Could not load runs”. */
  readonly errorLabel = input('Could not load');

  /** Pressed the retry — the caller re-issues its own request. */
  readonly retry = output<void>();

  protected readonly message = computed(() => {
    const state = this.state();
    return state.kind === 'error' ? state.message : '';
  });
}
