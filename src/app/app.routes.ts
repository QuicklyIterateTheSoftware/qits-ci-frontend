import type { CanMatchFn, Routes } from '@angular/router';
import { QITS_CATEGORIES, QitsMainLayout, type QitsCategory } from '@qits/ui-components';
import { NotFound } from './not-found/not-found';
import { RunPage } from './run/run-page';
import { TreePage } from './tree/tree-page';

/**
 * The pages this application owns, in both spellings of every address.
 *
 * **The tree is the root view**, not a child called `/tree`: `/` is where an operator arrives and
 * the tree is what they came for. Expansion is carried in query parameters (`?project=…&repo=…`)
 * rather than in path segments, because it is view state and the path is for resources — and
 * because query parameters keep the back button meaning "collapse".
 *
 * **A run is addressed by its runId alone.** `runs/<runId>`, never
 * `projects/<pid>/repos/<rid>/runs/<runId>`: a `CiRun` is keyed by an opaque `repoId` and knows a
 * project only when its push arrived on the public address, the project *name* is a join performed
 * in the browser against another service, and the nested form would be unresolvable for exactly the
 * runs that matter most here — the ones no project claims.
 *
 * Both pages load eagerly. There are two of them and they share every component below them; a lazy
 * chunk boundary here would be ceremony that costs a round trip.
 */
const own: Routes = [
  { path: '', component: TreePage },
  { path: 'runs/:runId', component: RunPage },
];

/**
 * Is `<project>/<category>/<repository>` a repository address, or this application's own three
 * segments?
 *
 * The category is what decides, because it is the one segment of the three drawn from a closed set.
 * Without this guard `runs/<id>/anything` would be read as a repository named `anything` inside a
 * project called `runs`, and the guard is cheap enough to run on every navigation.
 *
 * `segments` are the ones left at this level, so the category is `segments[1]` — the parent route
 * is the layout's `''` and consumes nothing.
 */
export const categoryIsKnown: CanMatchFn = (_route, segments) =>
  QITS_CATEGORIES.includes(segments[1]?.path as QitsCategory);

/**
 * Every route inside the platform chrome, three times: bare, under a project, under a repository.
 *
 * `QitsMainLayout` is the root *route* component rather than something the shell templates, so the
 * bar and the navigation mount once and survive every navigation beneath them; only the outlet's
 * content changes.
 *
 * **The same components serve all three forms.** `/runs/42`, `/qits/runs/42` and
 * `/qits/services/qits-ci/runs/42` are the same page about the same run; the later ones say which
 * project or repository the reader came in through, and the pages read that from `QITS_SCOPE`
 * rather than from the route parameters — which is why the scoped branches declare no readers of
 * `:project`, `:category` or `:repository` at all.
 *
 * **The project form is what the chrome's project picker navigates to.** `UrlScope.select(slug)`
 * goes to `/<slug>/`, so without this route picking a project here would land on the 404 page.
 *
 * **Order is the whole grammar**, and it works because the three vocabularies cannot collide: a
 * category is never a slug, and a slug is never one of this app's own first segments. Own routes
 * first, so `/runs/42` is this application's own address and never a project called `runs`; the
 * repository form next, guarded on the category; the project form last, which takes what is left.
 *
 * The `**` route sits *inside* the layout: this application is served at the root of its own host,
 * so an unknown URL under it is an ordinary 404 and is drawn with the chrome around it.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      ...own,
      { path: ':project/:category/:repository', canMatch: [categoryIsKnown], children: own },
      { path: ':project', children: own },
      { path: '**', component: NotFound },
    ],
  },
];
