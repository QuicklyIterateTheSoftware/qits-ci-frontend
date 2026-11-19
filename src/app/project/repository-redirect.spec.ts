import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideQitsNavigation, provideQitsNavigationTree } from '@qits/ui-components';
import { NAVIGATE_AWAY } from '../ui/navigate-away';
import { LANDING_ORIGIN_WAIT_MS } from './landing-origin';
import { RepositoryRedirect } from './repository-redirect';

/**
 * Where `/<project>/<group>/<repository>` sends a reader, in isolation from the routes that decide
 * it gets here at all — `app.routes.spec.ts` covers that the address and nothing else reaches this
 * component.
 *
 * `ActivatedRoute` is stubbed rather than routed to: this component reads only its parent's
 * `project` and `repository` params — never `group`, which proved the address but carries nothing
 * the destination needs — so a bare snapshot carrying those two is the whole fixture, and nothing
 * here needs a router or a mounted layout.
 *
 * The origin resolution itself — `qits-landing`'s own origin, the environment's, a relative path,
 * and the {@link LANDING_ORIGIN_WAIT_MS} bound on all three — is shared with `ProjectRedirect`
 * (`landing-origin.ts`, qits-2320) and is `project-redirect.spec.ts`'s to cover in full; this file
 * repeats each case once to prove this component asks for the right path on top of it, and drops
 * the group doing so.
 */
describe('RepositoryRedirect', () => {
  function configure(
    project: string,
    repository: string,
    group: string,
    ...providers: unknown[]
  ): { navigateAway: (url: string) => void } {
    const navigateAway = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { parent: { paramMap: convertToParamMap({ project, group, repository }) } },
          },
        },
        { provide: NAVIGATE_AWAY, useValue: navigateAway },
        ...providers,
      ],
    });
    return { navigateAway };
  }

  it('hands the reader to the landing app’s CI page for the repository, once the navigation names it', async () => {
    const { navigateAway } = configure(
      'qits',
      'qits-ci',
      'services',
      provideQitsNavigationTree({ applications: { 'qits-landing': { origin: 'https://landing.qits.example' } } }),
    );
    TestBed.createComponent(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://landing.qits.example/projects/qits/ci/qits-ci');
  });

  it('drops the group — it proved the address but names nothing the destination needs', async () => {
    const { navigateAway } = configure(
      'qits',
      'qits-ci',
      'qits-ci',
      provideQitsNavigationTree({ applications: { 'qits-landing': { origin: 'https://landing.qits.example' } } }),
    );
    TestBed.createComponent(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://landing.qits.example/projects/qits/ci/qits-ci');
  });

  it('encodes the project and the repository', async () => {
    const { navigateAway } = configure(
      'a b',
      'c d',
      'services',
      provideQitsNavigationTree({ applications: { 'qits-landing': { origin: 'https://landing.qits.example' } } }),
    );
    TestBed.createComponent(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://landing.qits.example/projects/a%20b/ci/c%20d');
  });

  it('drops a trailing slash the navigation’s origin carried', async () => {
    const { navigateAway } = configure(
      'qits',
      'qits-ci',
      'services',
      provideQitsNavigationTree({ applications: { 'qits-landing': { origin: 'https://landing.qits.example/' } } }),
    );
    TestBed.createComponent(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://landing.qits.example/projects/qits/ci/qits-ci');
  });

  it('falls back to the environment origin when the navigation names qits-landing with no host of its own', async () => {
    const { navigateAway } = configure(
      'qits',
      'qits-ci',
      'services',
      provideQitsNavigationTree({ origin: 'https://dev.qits.example' }),
    );
    TestBed.createComponent(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://dev.qits.example/projects/qits/ci/qits-ci');
  });

  it('falls back to a relative path with no navigation at all, same-origin like every other read before it', async () => {
    const { navigateAway } = configure('qits', 'qits-ci', 'services');
    TestBed.createComponent(RepositoryRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('/projects/qits/ci/qits-ci');
  });

  /**
   * A navigation that never answers must not strand the reader on this blank page forever —
   * {@link LANDING_ORIGIN_WAIT_MS} is the backstop, shared with `ProjectRedirect`.
   * `provideQitsNavigation()` makes the one real request this component waits on; leaving it
   * unflushed models a navigation that is slow, or dead, rather than one that answered with
   * nothing.
   */
  it('gives up waiting on the navigation past its bound rather than hang on one that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { navigateAway } = configure(
        'qits',
        'qits-ci',
        'services',
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigation(),
      );
      TestBed.createComponent(RepositoryRedirect);
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/main-navigation');
      expect(navigateAway).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(LANDING_ORIGIN_WAIT_MS);

      // Neither qits-landing's own origin nor the environment's is known without an answer, so
      // the last fallback — same-origin, a bare path — is what the reader gets rather than a hang.
      expect(navigateAway).toHaveBeenCalledWith('/projects/qits/ci/qits-ci');
    } finally {
      vi.useRealTimers();
    }
  });
});
