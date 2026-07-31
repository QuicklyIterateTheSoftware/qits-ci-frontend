import { InjectionToken } from '@angular/core';

/**
 * The origin every request in this app is built on, and it is empty on purpose.
 *
 * The SPA is served at `/ci/` by qits-ci itself, behind the same gateway that serves
 * `/projects/api/…` — so a same-origin absolute path is not a shortcut, it is the whole reason the
 * browser's session cookie reaches both services with no machine token and no CORS pre-flight. A
 * configured base URL would move these calls cross-origin and lose exactly that.
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
