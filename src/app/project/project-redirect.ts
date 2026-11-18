import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { QitsAppLinks } from '@qits/ui-components';
import { NAVIGATE_AWAY } from '../ui/navigate-away';

/**
 * How long this page waits for the navigation to name `qits-landing`'s origin before giving up on
 * it and using whatever `QitsAppLinks.environmentOrigin` already answers.
 *
 * A work ref (`landingWorkLink`, `@qits/ui-components`) never needs a bound: it is drawn once the
 * chrome around it has already asked the navigation the question, so the answer is already in
 * memory by the time anyone clicks it. This page has no such luxury — it can be the very first
 * thing a browser requests, with no chrome mounted yet to have asked first — so it waits itself,
 * briefly, rather than firing at an origin it has not actually been told yet.
 */
export const LANDING_ORIGIN_WAIT_MS = 1500;

/**
 * Where `qits-landing` answers, on {@link landingWorkLink}'s own terms: `QitsAppLinks.origin`
 * first, `environmentOrigin` second — which on this platform *is* the apex landing serves from —
 * same origin (the bare path, used as it is) third.
 *
 * `whenApiOrigin('qits-landing')` settles the moment the navigation does, which on a warm platform
 * (one that already answered, or a literal tree in a spec) is a single microtask. Past
 * {@link LANDING_ORIGIN_WAIT_MS} the wait is abandoned and `environmentOrigin` is read as it stands
 * right now instead, so a reader is never left on this blank page by a navigation that is merely
 * slow — or that never answers at all.
 */
async function landingCiOrigin(links: QitsAppLinks): Promise<string> {
  const settled = links
    .whenApiOrigin('qits-landing')
    .then(() => links.origin('qits-landing') ?? links.environmentOrigin() ?? '');
  const bound = new Promise<string>((resolve) => {
    setTimeout(() => resolve(links.environmentOrigin() ?? ''), LANDING_ORIGIN_WAIT_MS);
  });
  return Promise.race([settled, bound]);
}

/**
 * The bare project address, `/<slug>` — the `''` child of `:project` alone, never the run or
 * repository forms beside it, which keep rendering here unchanged.
 *
 * It draws nothing of its own. `/<slug>` used to open this application's tree scoped to that
 * project; qits-2314 hands that page to the landing app instead, whose own address for it is
 * `/projects/<slug>/ci` — so this component's only job is a full-document hand-off,
 * `<landing origin>/projects/<slug>/ci`, through {@link NAVIGATE_AWAY} rather than the router: the
 * destination is a different Angular application, and a `routerLink` would compile and go nowhere.
 * The run and repository forms are untouched, and move to landing on their own tickets —
 * qits-2321 and qits-2320 — not this one.
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
    void landingCiOrigin(links).then((origin) => {
      navigateAway(`${origin.replace(/\/+$/, '')}/projects/${encodeURIComponent(slug)}/ci`);
    });
  }
}
