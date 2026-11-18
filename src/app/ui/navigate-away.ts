import { InjectionToken } from '@angular/core';

/**
 * A full-document navigation away from this application, kept behind a token so a spec can watch
 * what a page asked for instead of the browser actually leaving it mid-test.
 *
 * `location.replace` rather than `.href` or the router: whatever calls this is leaving for an
 * address this application does not serve, and the page it is leaving must not become the back
 * button's next stop.
 */
export const NAVIGATE_AWAY = new InjectionToken<(url: string) => void>('NAVIGATE_AWAY', {
  factory: () => (url: string) => window.location.replace(url),
});
