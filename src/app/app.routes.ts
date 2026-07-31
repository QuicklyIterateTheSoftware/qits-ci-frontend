import type { Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { NotFound } from './not-found/not-found';
import { RunPage } from './run/run-page';
import { TreePage } from './tree/tree-page';

/**
 * Three routes, all of them inside the platform chrome.
 *
 * `QitsMainLayout` is the root *route* component rather than something the shell templates, so the
 * bar and the navigation mount once and survive every navigation beneath them; only the outlet's
 * content changes.
 *
 * **The tree is the root view**, not a child called `/tree`: `/ci/` is where an operator arrives
 * and the tree is what they came for. Expansion is carried in query parameters
 * (`/ci/?project=…&repo=…`) rather than in path segments, because it is view state and the path is
 * for resources — and because query parameters keep the back button meaning "collapse".
 *
 * **A run is addressed by its runId alone.** `/ci/runs/<runId>`, never
 * `/ci/projects/<pid>/repos/<rid>/runs/<runId>`: a `CiRun` is keyed by `repoId` and knows nothing
 * about projects, the project association is a join performed in the browser against another
 * service, and the nested form would be unresolvable for exactly the runs that matter most here —
 * the ones no project claims. `runId` is the run's identity, so it is the whole path.
 *
 * Both pages load eagerly. There are two of them and they share every component below them; a lazy
 * chunk boundary here would be ceremony that costs a round trip.
 *
 * The `**` route sits *inside* the layout, unlike spa-home's. spa-home is mounted at the gateway
 * root, where an unrecognised first segment belongs to another application and has to be handed
 * back; `/ci/` is a segment this application owns outright, so an unknown URL under it is an
 * ordinary 404 and is drawn with the chrome around it.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      { path: '', component: TreePage },
      { path: 'runs/:runId', component: RunPage },
      { path: '**', component: NotFound },
    ],
  },
];
