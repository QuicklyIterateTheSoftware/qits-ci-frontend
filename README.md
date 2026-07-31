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

`src/app/api/` holds hand-written interfaces mirroring the two services' wire shapes, one injectable
service each, over `HttpClient` on the fetch backend. Nothing is generated: the total surface is six
endpoints, and the platform generates OpenAPI documents rather than clients.

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
