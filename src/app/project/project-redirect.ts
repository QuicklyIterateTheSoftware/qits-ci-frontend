import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { QitsAppLinks } from '@qits/ui-components';
import { NAVIGATE_AWAY } from '../ui/navigate-away';
import { landingOrigin } from './landing-origin';

// Re-exported so a caller that reads the bound from this module, as it did before the bound moved
// into `landing-origin.ts` (qits-2320, shared with `RepositoryRedirect`), keeps working unchanged.
export { LANDING_ORIGIN_WAIT_MS } from './landing-origin';

/**
 * The bare project address, `/<slug>` — the `''` child of `:project` alone, never the run form
 * beside it, which hands off on its own terms (`RunRedirect`, qits-2321). (The repository form had
 * its own `''` child beside this one; it moved to {@link RepositoryRedirect} on the same terms,
 * qits-2320.)
 *
 * It draws nothing of its own. `/<slug>` used to open this application's tree scoped to that
 * project; qits-2314 hands that page to the landing app instead, whose own address for it is
 * `/projects/<slug>/ci` — so this component's only job is a full-document hand-off,
 * `<landing origin>/projects/<slug>/ci`, through {@link NAVIGATE_AWAY} rather than the router: the
 * destination is a different Angular application, and a `routerLink` would compile and go nowhere.
 * The run form moved to landing on its own ticket — qits-2321, `RunRedirect` — not this one.
 */
@Component({
  selector: 'app-project-redirect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class ProjectRedirect {
  constructor() {
    const slug = inject(ActivatedRoute).snapshot.parent?.paramMap.get('project') ?? '';
    const links = inject(QitsAppLinks);
    const navigateAway = inject(NAVIGATE_AWAY);
    void landingOrigin(links).then((origin) => {
      navigateAway(`${origin.replace(/\/+$/, '')}/projects/${encodeURIComponent(slug)}/ci`);
    });
  }
}
