import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { QitsAppLinks } from '@qits/ui-components';
import { NAVIGATE_AWAY } from '../ui/navigate-away';
import { landingOrigin } from './landing-origin';

/**
 * The bare repository address, `/<project>/<group>/<repository>` — the `''` child of the
 * `:project/:group/:repository` route alone, never the run form beside it
 * (`/<project>/<group>/<repository>/runs/<runId>`), which hands off on its own terms
 * (`RunRedirect`, qits-2321).
 *
 * It draws nothing of its own. The address used to open this application's tree scoped to that
 * one repository; qits-2320 hands that page to the landing app instead, whose own address for it
 * is `/projects/<project>/ci/<repository>` — so this component's only job is a full-document
 * hand-off, `<landing origin>/projects/<project>/ci/<repository>`, through {@link NAVIGATE_AWAY}
 * rather than the router: the destination is a different Angular application, and a `routerLink`
 * would compile and go nowhere.
 *
 * The group is read and then dropped. It is what told the route this was a repository address at
 * all — component or category, {@link isRepositoryAddress} does not care which — but landing's
 * own address has no segment for it: a repository name is unique inside its project, so the group
 * carries no information the destination needs.
 */
@Component({
  selector: 'app-repository-redirect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class RepositoryRedirect {
  constructor() {
    const parent = inject(ActivatedRoute).snapshot.parent?.paramMap;
    const project = parent?.get('project') ?? '';
    const repository = parent?.get('repository') ?? '';
    const links = inject(QitsAppLinks);
    const navigateAway = inject(NAVIGATE_AWAY);
    void landingOrigin(links).then((origin) => {
      navigateAway(
        `${origin.replace(/\/+$/, '')}/projects/${encodeURIComponent(project)}/ci/${encodeURIComponent(repository)}`,
      );
    });
  }
}
