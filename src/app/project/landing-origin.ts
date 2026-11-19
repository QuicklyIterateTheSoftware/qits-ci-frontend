import type { QitsAppLinks } from '@qits/ui-components';

/**
 * How long a hand-off page waits for the navigation to name `qits-landing`'s origin before giving
 * up on it and using whatever `QitsAppLinks.environmentOrigin` already answers.
 *
 * A work ref (`landingWorkLink`, `@qits/ui-components`) never needs a bound: it is drawn once the
 * chrome around it has already asked the navigation the question, so the answer is already in
 * memory by the time anyone clicks it. A hand-off page has no such luxury — it can be the very
 * first thing a browser requests, with no chrome mounted yet to have asked first — so it waits
 * itself, briefly, rather than firing at an origin it has not actually been told yet.
 */
export const LANDING_ORIGIN_WAIT_MS = 1500;

/**
 * Where `qits-landing` answers, on {@link landingWorkLink}'s own terms: `QitsAppLinks.origin`
 * first, `environmentOrigin` second — which on this platform *is* the apex landing serves from —
 * same origin (the bare path, used as it is) third.
 *
 * `whenApiOrigin('qits-landing')` settles the moment the navigation does, which on a warm platform
 * (one that already answered, or a literal tree in a spec) is a single microtask. Past
 * {@link LANDING_ORIGIN_WAIT_MS} the wait is abandoned and `environmentOrigin` is read as it
 * stands right now instead, so a reader is never left on a blank hand-off page by a navigation
 * that is merely slow — or that never answers at all.
 *
 * Shared by every hand-off page ({@link ProjectRedirect}, {@link RepositoryRedirect}, and
 * `RunRedirect` and `handOffRun` under `run/`, qits-2321): the rule is the same whichever address
 * is leaving, only the path built on top of the origin differs.
 */
export async function landingOrigin(links: QitsAppLinks): Promise<string> {
  const settled = links
    .whenApiOrigin('qits-landing')
    .then(() => links.origin('qits-landing') ?? links.environmentOrigin() ?? '');
  const bound = new Promise<string>((resolve) => {
    setTimeout(() => resolve(links.environmentOrigin() ?? ''), LANDING_ORIGIN_WAIT_MS);
  });
  return Promise.race([settled, bound]);
}
