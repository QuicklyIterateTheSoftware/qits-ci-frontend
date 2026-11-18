import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideQitsNavigation, provideQitsNavigationTree } from '@qits/ui-components';
import { NAVIGATE_AWAY } from '../ui/navigate-away';
import { LANDING_ORIGIN_WAIT_MS, ProjectRedirect } from './project-redirect';

/**
 * Where `/<slug>` sends a reader, in isolation from the routes that decide it gets here at all —
 * `app.routes.spec.ts` covers that `/<slug>` and nothing else reaches this component.
 *
 * `ActivatedRoute` is stubbed rather than routed to: this component reads only its parent's
 * `project` param, so a bare snapshot carrying that is the whole fixture, and nothing here needs a
 * router or a mounted layout.
 */
describe('ProjectRedirect', () => {
  function configure(slug: string, ...providers: unknown[]): { navigateAway: (url: string) => void } {
    const navigateAway = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { parent: { paramMap: convertToParamMap({ project: slug }) } } },
        },
        { provide: NAVIGATE_AWAY, useValue: navigateAway },
        ...providers,
      ],
    });
    return { navigateAway };
  }

  it('hands the reader to the landing app’s CI page for the project, once the navigation names it', async () => {
    const { navigateAway } = configure(
      'qits',
      provideQitsNavigationTree({ applications: { 'qits-landing': { origin: 'https://landing.qits.example' } } }),
    );
    TestBed.createComponent(ProjectRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://landing.qits.example/projects/qits/ci');
  });

  it('encodes the slug', async () => {
    const { navigateAway } = configure(
      'a b',
      provideQitsNavigationTree({ applications: { 'qits-landing': { origin: 'https://landing.qits.example' } } }),
    );
    TestBed.createComponent(ProjectRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://landing.qits.example/projects/a%20b/ci');
  });

  it('drops a trailing slash the navigation’s origin carried', async () => {
    const { navigateAway } = configure(
      'qits',
      provideQitsNavigationTree({ applications: { 'qits-landing': { origin: 'https://landing.qits.example/' } } }),
    );
    TestBed.createComponent(ProjectRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://landing.qits.example/projects/qits/ci');
  });

  it('falls back to the environment origin when the navigation names qits-landing with no host of its own', async () => {
    const { navigateAway } = configure('qits', provideQitsNavigationTree({ origin: 'https://dev.qits.example' }));
    TestBed.createComponent(ProjectRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('https://dev.qits.example/projects/qits/ci');
  });

  it('falls back to a relative path with no navigation at all, same-origin like every other read before it', async () => {
    const { navigateAway } = configure('qits');
    TestBed.createComponent(ProjectRedirect);
    await vi.waitFor(() => expect(navigateAway).toHaveBeenCalled());
    expect(navigateAway).toHaveBeenCalledWith('/projects/qits/ci');
  });

  /**
   * A navigation that never answers must not strand the reader on this blank page forever —
   * {@link LANDING_ORIGIN_WAIT_MS} is the backstop. `provideQitsNavigation()` makes the one real
   * request this component waits on; leaving it unflushed models a navigation that is slow, or
   * dead, rather than one that answered with nothing.
   */
  it('gives up waiting on the navigation past its bound rather than hang on one that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { navigateAway } = configure('qits', provideHttpClient(), provideHttpClientTesting(), provideQitsNavigation());
      TestBed.createComponent(ProjectRedirect);
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/main-navigation');
      expect(navigateAway).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(LANDING_ORIGIN_WAIT_MS);

      // Neither qits-landing's own origin nor the environment's is known without an answer, so
      // the last fallback — same-origin, a bare path — is what the reader gets rather than a hang.
      expect(navigateAway).toHaveBeenCalledWith('/projects/qits/ci');
    } finally {
      vi.useRealTimers();
    }
  });
});
