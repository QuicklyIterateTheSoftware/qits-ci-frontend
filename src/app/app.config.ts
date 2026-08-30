import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideQitsNavigation, provideQitsProjects, provideQitsScope } from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Six providers, in the order spa-home documents. The third arrived with this application — it was
 * the platform's first SPA to make a request — and the last two now make requests of their own.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries the tree's expansion in its query parameters and the run id in its
 *   path, so it is what makes both screens bookmarkable.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. Every call this app makes is a same-origin path — the API keeps its
 *   `/ci` segment and every service's segment is path-routed on every host — which is what lets the
 *   browser's session cookie reach `/projects/api/…` with no machine token and no CORS.
 * - `provideQitsNavigation` gives `QitsMainLayout` its left navigation, by asking the edge for
 *   `/main-navigation` once at startup. The tree is the edge's answer — derived from the
 *   deployments it actually serves — not a list compiled into @qits/ui-components; without this
 *   provider the chrome renders no links at all. It needs the `provideHttpClient` above.
 * - `provideQitsProjects` puts the project picker in the chrome's top-left slot and loads the
 *   repositories of whatever project is open, from `GET /projects/api/projects` and one listing per
 *   project. Both feed the sidebar's tree.
 * - `provideQitsScope('repository')` says how deep this application's own addresses go: its pages
 *   are about one repository, so it serves `/<slug>/<group>/<repo>/…` beside its own bare paths
 *   and the picker navigates here rather than leaving for qits-projects.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('repository'),
  ],
};
