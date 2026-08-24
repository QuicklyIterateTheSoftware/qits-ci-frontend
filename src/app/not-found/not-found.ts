import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QITS_SCOPE, scopeCommands } from '@qits/ui-components';

/**
 * A URL on this host that this app does not recognise.
 *
 * It renders a small page and stops there. There is nobody to hand the URL back to: the edge routed
 * this host to qits-ci on purpose, so an unknown path here is a typo rather than another
 * application's address, and bouncing it back would be a loop.
 *
 * The way out keeps whatever the address said was in scope — a mistyped tail under a repository
 * should not also lose the repository.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>No such page here</h1>
    <p>This is the CI explorer. It has a run tree and a page per run, and nothing else.</p>
    <p><a [routerLink]="home()">Back to the run tree</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {
  private readonly qitsScope = inject(QITS_SCOPE);

  protected readonly home = computed<string[]>(() => [...scopeCommands(this.qitsScope.scope())]);
}
