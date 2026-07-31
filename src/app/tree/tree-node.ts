import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * One expandable row of the tree: a chevron, a label, an optional tag and an optional right-hand
 * meta line — and whatever the caller nests inside it.
 *
 * The row carries a second, *named* slot — `[badges]` — for the annotations a caller wants beside
 * the name rather than under it. It sits between the toggle and the right-hand tag, which is why
 * the toggle no longer grows to fill the row: a spring after the badges pushes the tag and the meta
 * to the edge, so a row with no badges is drawn exactly as it was.
 *
 * The children are ordinary projected content and this component never wraps them in a condition.
 * That is the load-bearing part: the *caller* decides whether to build them, so a collapsed node
 * has no children in the DOM and — because building them is what starts a fetch — has made no
 * request either. A node that rendered its children and hid them with CSS would fan out the whole
 * tree on load, which is the exact cost Decision 3 exists to avoid.
 *
 * The row is a `<button>` because it toggles state in place; it is not a link, because expanding a
 * node navigates only in the query-parameter sense and the caller owns that.
 */
@Component({
  selector: 'app-tree-node',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <button
        type="button"
        class="twist"
        [attr.aria-expanded]="expanded()"
        (click)="toggled.emit()"
      >
        <span class="chevron" aria-hidden="true">{{ expanded() ? '▾' : '▸' }}</span>
        <span class="label">{{ label() }}</span>
      </button>
      <span class="badges"><ng-content select="[badges]" /></span>
      <span class="spring"></span>
      @if (tag()) {
        <span class="tag">{{ tag() }}</span>
      }
      @if (meta()) {
        <span class="meta">{{ meta() }}</span>
      }
    </div>
    <div class="children">
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.1rem 0;
    }
    .twist {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      flex: 0 1 auto;
      min-width: 0;
      background: none;
      border: 0;
      padding: 0.15rem 0.2rem;
      margin: 0;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
      border-radius: 0.25rem;
    }
    .twist:hover {
      background: #eef2ff;
    }
    .twist:focus-visible {
      outline: 2px solid #4f46e5;
      outline-offset: 1px;
    }
    .chevron {
      width: 0.9rem;
      flex: none;
      color: #6b7280;
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badges {
      display: inline-flex;
      align-items: baseline;
      gap: 0.35rem;
      flex: 0 1 auto;
      min-width: 0;
    }
    .spring {
      flex: 1 1 auto;
    }
    .tag {
      flex: none;
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      color: #4b5563;
      background: #f3f4f6;
      border-radius: 0.25rem;
      padding: 0 0.35rem;
    }
    .meta {
      flex: none;
      color: #6b7280;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .children {
      padding-left: 1.25rem;
      border-left: 1px solid #e5e7eb;
      margin-left: 0.55rem;
    }
  `,
})
export class TreeNode {
  /** What the row is called. */
  readonly label = input.required<string>();

  /** A short classification beside the label — an archetype, a branch. */
  readonly tag = input('');

  /** The right-hand count or summary. */
  readonly meta = input('');

  /** Whether the caller is currently rendering children into it. */
  readonly expanded = input(false);

  /** The row was pressed; the caller flips its own state and the URL. */
  readonly toggled = output<void>();
}
