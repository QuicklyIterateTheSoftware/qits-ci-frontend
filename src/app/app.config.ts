import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideQitsNavigation } from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Four providers, in the order spa-home documents. The third arrived with this application — it was
 * the platform's first SPA to make a request — and the fourth now makes one of its own.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries the tree's expansion in its query parameters and the run id in its
 *   path, so it is what makes both screens bookmarkable.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. Every call this app makes is a same-origin path behind the gateway,
 *   which is what lets the browser's session cookie reach `/projects/api/…` from a page served at
 *   `/ci/` with no machine token and no CORS.
 * - `provideQitsNavigation` gives `QitsMainLayout` its left navigation, by asking the gateway for
 *   `/main-navigation` once at startup. The list is the gateway's answer now — derived from the
 *   routes it actually serves — not a list compiled into @qits/ui-components; without this provider
 *   the chrome renders no links at all. It needs the `provideHttpClient` above.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
  ],
};
