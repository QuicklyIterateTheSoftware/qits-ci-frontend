import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  provideQitsBuilds,
  provideQitsNavigation,
  provideQitsProjects,
  provideQitsScope,
  provideQitsStandardReportKinds,
} from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Eight providers, in the order spa-home documents. The third arrived with this application — it
 * was the platform's first SPA to make a request — and the last four now make requests of their
 * own.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries the tree's expansion in its query parameters and the run id in its
 *   path, so it is what makes both screens bookmarkable.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. This app's own reads (`/ci/api/…`) are same-origin paths and carry no
 *   credential; a read of another application's API — `/projects/api/…` among them — goes to that
 *   application's own origin from the navigation below, with the session.
 * - `provideQitsNavigation` gives `QitsMainLayout` its left navigation, by asking the edge for
 *   `/main-navigation` once at startup. The tree is the edge's answer — derived from the
 *   deployments it actually serves — not a list compiled into @qits/ui-components; without this
 *   provider the chrome renders no links at all, and `QitsAppLinks` has nowhere to read an
 *   application's origin from. It needs the `provideHttpClient` above.
 * - `provideQitsProjects` puts the project picker in the chrome's top-left slot and loads the
 *   repositories of whatever project is open, from `GET /projects/api/projects` on qits-projects'
 *   own origin and one listing per project. Both feed the sidebar's tree.
 * - `provideQitsScope('repository')` says how deep this application's own addresses go: its pages
 *   are about one repository, so it serves `/<slug>/<group>/<repo>/…` beside its own bare paths
 *   and the picker navigates here rather than leaving for qits-projects.
 * - `provideQitsBuilds` puts the pending-builds bolt beside that picker: a popover of the active
 *   runs, from `GET /ci/api/runs/active` on this application's own origin — the one call here that
 *   stays same-origin, since this is qits-ci's own read. It is the chrome's version of the tree
 *   page's right rail, and it is provided here for the reason it is provided anywhere: the bolt
 *   means the same thing in every SPA, and an operator who has navigated away from the tree has not
 *   stopped caring what is building. Nothing is asked while the panel is closed; it polls only for
 *   as long as one is open.
 * - `provideQitsStandardReportKinds` registers the two shipped report kinds — `test-results` and
 *   `coverage` — with `QITS_REPORT_KINDS`, so the run page's `<qits-run-reports>` has a component to
 *   draw for each instead of falling back to "no view for this report kind here". It needs no
 *   `provideHttpClient` of its own: the area it feeds reads through `QitsReportsClient`, which uses
 *   the one installed above.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('repository'),
    provideQitsBuilds(),
    provideQitsStandardReportKinds(),
  ],
};
