import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A URL under `/ci/` that this app does not recognise.
 *
 * It renders a small page and stops there. It deliberately does **not** copy spa-home's exit
 * behaviour of handing the URL back to the gateway: that is the landing page's job, and it is
 * correct only because spa-home is mounted at the root, where an unknown first segment is another
 * micro frontend rather than a typo. Here the segment is already ours — the gateway routed `/ci/…`
 * to qits-ci on purpose — so there is nobody to hand it to, and bouncing it back would be a loop.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>No such page here</h1>
    <p>This is the CI explorer. It has a run tree and a page per run, and nothing else.</p>
    <p><a routerLink="/">Back to the run tree</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {}
