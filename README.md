# QitsSpaCi

The CI explorer: the read-only view of what qits-ci has run, served by qits-ci itself at `/ci/`
through Quinoa. Two screens, no forms, and one write.

- **`/ci/`** — the run tree. Projects (from qits-projects) → repositories → trigger-type groups →
  runs. Every level loads on expansion and caches; the page itself makes two requests, both flat
  lists. Expansion is carried in the query parameters (`/ci/?project=…&repo=…`), so it is
  bookmarkable and the back button collapses.
- **`/ci/runs/<runId>`** — one run: provenance, steps, step output, and while it is `RUNNING` the
  live step and a cancel button. It polls every three seconds while the run is running, stops on the
  first terminal answer, and pauses while the tab is hidden.

The tree draws a **`Not claimed by any project`** bucket, always, from `GET /ci/api/repositories`.
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
read anywhere. A run that starts *and* finishes between two ticks is never drawn as active and still
lands in the stack.

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

`proxy.conf.json` forwards `/ci/api` and `/projects/api` to a gateway on `localhost:8080`, because
`ng serve` puts no gateway in front and both screens read across two services. In a deployment every
call is a same-origin path behind the real gateway, which is what carries the session cookie.

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
