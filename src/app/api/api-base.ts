import { InjectionToken } from '@angular/core';

/**
 * The origin this app's OWN reads are built on, and it is empty on purpose.
 *
 * The SPA is served at `/ci/` by qits-ci itself, so a same-origin relative path reaches qits-ci's
 * own `/ci/api/…` with no machine token and no CORS pre-flight. It is used only by `CiApi`:
 * another application's API — `/projects/api/…` among them — is no longer routed on this host, so
 * those reads go to that application's own origin via `QitsAppLinks`, not through this token.
 *
 * It is a token rather than a constant for one reason: a spec needs a seam to assert the path
 * against, and `ng serve` (no gateway in front) may want the dev proxy's prefix. That is the same
 * shape spa-home's `LEAVE_APP` uses — the platform's one DI-token precedent — and it adds no
 * behaviour, only a handle.
 */
export const QITS_API_BASE = new InjectionToken<string>('qits.api-base', {
  providedIn: 'root',
  factory: () => '',
});
