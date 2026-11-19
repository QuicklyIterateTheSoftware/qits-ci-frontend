import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, type CanActivateFn } from '@angular/router';
import { QitsAppLinks } from '@qits/ui-components';
import { CiApi } from '../api/ci-api';
import { ProjectsApi } from '../api/projects-api';
import { landingOrigin } from '../project/landing-origin';
import { NAVIGATE_AWAY } from '../ui/navigate-away';

/**
 * How long the bare run address, `/runs/<runId>`, waits to learn which project the run belongs to
 * before giving up on handing it off and drawing `RunPage` here instead.
 *
 * The scoped forms never wait on this: their address already names the project. The bare one has
 * to read the run and the project list first, and a reader who opened a bookmark must not stare at
 * a blank page because either read is slow — past this bound the old page is the answer.
 */
export const RUN_LOOKUP_WAIT_MS = 3000;

/** `<landing origin>/projects/<project>/ci/runs/<runId>`, every segment encoded. */
function landingRunAddress(origin: string, project: string, runId: string): string {
  return `${origin.replace(/\/+$/, '')}/projects/${encodeURIComponent(project)}/ci/runs/${encodeURIComponent(runId)}`;
}

/**
 * A run under a project or a repository, `/<project>/runs/<runId>` and
 * `/<project>/<group>/<repository>/runs/<runId>` — the `runs/:runId` child of both scoped forms.
 *
 * It draws nothing of its own. Both addresses used to draw `RunPage` here; qits-2321 hands
 * the run to the landing app instead, whose own address for it is
 * `/projects/<project>/ci/runs/<runId>` — so this component's only job is a full-document hand-off
 * through {@link NAVIGATE_AWAY}, on the same terms as `ProjectRedirect` and `RepositoryRedirect`.
 *
 * The address already names the project, so no read is made: `runId` is this route's own param,
 * `project` its parent's. The repository form's group and repository are read by nobody — landing's
 * run address is keyed by the project and the run alone, and a run id is unique on the platform.
 */
@Component({
  selector: 'app-run-redirect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class RunRedirect {
  constructor() {
    const snapshot = inject(ActivatedRoute).snapshot;
    const runId = snapshot.paramMap.get('runId') ?? '';
    const project = snapshot.parent?.paramMap.get('project') ?? '';
    const links = inject(QitsAppLinks);
    const navigateAway = inject(NAVIGATE_AWAY);
    void landingOrigin(links).then((origin) => {
      navigateAway(landingRunAddress(origin, project, runId));
    });
  }
}

/**
 * The bare run address, `/runs/<runId>`, handed off to the landing app when the run names a project
 * this platform knows — and left to `RunPage` here when it does not.
 *
 * Unlike the scoped forms the address carries no slug, so it is read: the run first (`projectId`),
 * then — only when the run names one — the project list, to turn that id into the slug landing's
 * address is spelled with. Either read failing, a run that names no project (an id-addressed push,
 * a row older than the campaign), a project id no listed project carries, or the whole lookup
 * outlasting {@link RUN_LOOKUP_WAIT_MS}: each of those activates the route as it always did, so a
 * bookmark always lands somewhere.
 *
 * A guard rather than a wrapper component, so the fallback *is* `RunPage` on its own route and
 * nothing about that page's layout or reading of the route changes. The cost is that the fallback
 * reads the run a second time; a bounded lookup that runs once per opened address does not earn a
 * cache shared with the page.
 */
export const handOffRun: CanActivateFn = async (route) => {
  const ci = inject(CiApi);
  const projects = inject(ProjectsApi);
  const links = inject(QitsAppLinks);
  const navigateAway = inject(NAVIGATE_AWAY);
  const runId = route.paramMap.get('runId') ?? '';

  const lookup = (async (): Promise<string | null> => {
    const run = await ci.run(runId);
    if (!run.projectId) return null;
    const project = (await projects.projects()).find((candidate) => candidate.id === run.projectId);
    return project?.slug ?? null;
  })().catch(() => null);
  const bound = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), RUN_LOOKUP_WAIT_MS);
  });

  const slug = await Promise.race([lookup, bound]);
  if (slug === null) return true;
  navigateAway(landingRunAddress(await landingOrigin(links), slug, runId));
  return false;
};
