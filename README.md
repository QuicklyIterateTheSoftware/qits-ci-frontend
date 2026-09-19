# qits-ci-frontend

The CI explorer: the read-only view of what qits-ci has run, served by qits-ci itself at the root of
its own host (`ci.<env>.<domain>/`) through Quinoa. Two screens, no forms, and two writes.

- **`/`** — the run tree. Projects (from qits-projects) → repositories → trigger-type groups →
  runs. Every level loads on expansion and caches; the page itself makes two requests, both flat
  lists. Expansion is carried in the query parameters (`/?project=…&repo=…`), so it is
  bookmarkable and the back button collapses.
- **`/runs/<runId>`** — one run: provenance, steps, step output, and while it is `RUNNING` the
  live step. It polls every three seconds while the run is running, stops on the
  first terminal answer, and pauses while the tab is hidden.

  Its two buttons are complements and never both offered. **Cancel run** appears while the run is
  `QUEUED` or `RUNNING` — queued is the case it is most worth having, since the run has not started
  and stopping it costs nothing — and is guarded by a confirmation, because it destroys work in
  flight. **Run again** appears on every terminal status and sends `POST
  /ci/api/runs/<runId>/retry`, which queues a new run of the same pipeline at the same commit and
  answers its id; the page then follows it. That one is unconfirmed on purpose: it only adds a run,
  and a confirmation on a harmless action trains people to click through the one that is not. A 409
  from either is the run having moved between the render and the click — the cancel shrugs at it,
  the retry reports it, since nothing the reader asked for happened.

  A `CANCELLED` run says so in words beside its badge: qits-ci publishes **no** build event for a
  stopped run, so nothing downstream is gated on it and no release is held by it. "The run is red"
  and "somebody stopped the run" lead to opposite next actions, which is why the badge alone is not
  enough. A run that gates a release request shows its `releaseRequestId`, and a re-run links back
  to the run it re-fires.

A run still in flight also carries the **shape it is expected to take**: qits-ci answers a p95 of
each planned step's historical runtime in the same pipeline, on the listings as well as on the single
read, and both screens draw it with `<qits-step-progress>` from `@qits/ui-components` — one bubble
per **planned** step, each as wide as that step's share of the expected total, with a one-percent
seam carved out of the bubble *before* each boundary so the divisions land where the steps actually
change.

**Each bubble fills from its own step**, against its own expectation: 0 for a step the run has not
reached, 100 for one that has finished, and `now - startedAt` for the one in flight, ticking on the
component's own one-second clock and never polling. That is the one rule the bar exists to keep. It
used to draw the seams from the prediction and then fill *the whole track* from wall-clock elapsed
against the predicted *total*, which is backwards from what a segmented bar appears to promise — a
step that overran ate the seams after it, and a step that finished early left the next segment
filling before that step had started. The seams were real boundaries of a prediction drawn as if
they were boundaries of the build. Two copies of that math existed, one here and one in
`QitsMainLayout`; they are one component now, and this repository is its second caller.

The mapping from a `CiRunDto` to that component's input lives in one place, `src/app/ui/expected-steps.ts`,
and is keyed by **`stepIndex`** rather than by array position — a step is persisted when it *ends*,
so mid-run `steps` is shorter than the pipeline and its element order says nothing about which step
is which. `live.stepIndex` supplies the in-flight step's start and never overrides a persisted one,
so a stale pointer cannot reopen a step that has already finished.

A queued run draws the empty track; a run that outlasts its own history holds at full and shifts
tone, because the number is a shape and not a deadline. The run page adds the expected total beside
`Duration` — kept on finished runs too, since a duration only reads as fast or slow next to one —
and each step's expectation beside what it actually took, which is the same reading the bar draws to
scale. A run that predicts nothing renders exactly as it did before any of this existed.

Both screens answer at a **scoped** address too — `/<projectSlug>/<group>/<repoName>/` and
`/<projectSlug>/<group>/<repoName>/runs/<runId>` — which is the platform-wide URL grammar every
SPA here shares. The middle segment is the repository's component where the platform gives it one
and its archetype category where it does not; both spellings resolve to the same page. The pages read that scope from `@qits/ui-components` rather than from route
parameters, so one component serves both spellings: scoped, the tree draws the named repository open
inside its project and leaves out everything else, including the unattributed bucket.

Unscoped, the tree draws a **`Not claimed by any project`** bucket, always, from
`GET /ci/api/repositories`.
qits-ci keys a run by the git-host repository directory name, and the platform's own repositories
were seeded onto the git host with no qits-projects row — so that bucket is where the run history
actually is until those repositories are onboarded, and hiding it would make the tree look empty
while the data sat one join away.

The right rail carries two lists, and they are complements of one another. Below is **`Active
runs`** — every `QUEUED` or `RUNNING` run on the platform, whatever repository it belongs to, from
`GET /ci/api/runs/active`. Above it is **`Finished runs`**, seeded with the newest five from `GET
/ci/api/runs/finished?limit=5`, oldest at the top so it reads forwards in time down into the runs
still in flight. Both are re-read on one ten-second tick, which is also how a completion is
detected: a run leaves the first list and arrives in the second on the same tick, with no per-run
read anywhere. A run that starts _and_ finishes between two ticks is never drawn as active and still
lands in the stack.

A queued row in the active list says **when it is expected to move**, not only how long it has been
waiting: where it sits in qits-ci's claim order (`next in the queue`, `#3 in the queue`), when it is
expected to start and when to finish. Both spans arrive relative to the response's own instant and
are spelled approximately — `starts in about 12 min` — never as a clock time, because the number is
a p95 and "at 14:32" is a commitment that is wrong the moment the queue moves. The elapsed wait stays
beside it: how long it has waited and when it will start are different facts. A run qits-ci cannot
forecast **says so and says which case it is** — this pipeline has never run to completion, a run
queued ahead of it has never been measured, a run already executing has never been measured — rather
than falling back to the bare elapsed time, which reads as "nothing to see here".

The finished stack is **append-only for as long as the page is open** — five rows become six, then
seven — and a reload starts again at five. Nothing is ever trimmed while you watch, because a rail
that re-seeded on every poll would drop the run you were looking at exactly when a burst of builds
made the history worth having.

`src/app/api/` holds hand-written interfaces mirroring the two services' wire shapes, one injectable
service each, over `HttpClient` on the fetch backend. Nothing is generated: the total surface is
seven endpoints, and the platform generates OpenAPI documents rather than clients.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The
application will automatically reload whenever you modify any of the source files.

`proxy.conf.json` forwards `/ci/api`, `/projects/api` and `/main-navigation` to the edge on
`localhost:8080`, because `ng serve` puts no edge in front and both screens read across two services
plus the chrome. APIs keep their segment on every host, so in a deployment every one of those is a
same-origin path, which is what carries the session cookie.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
