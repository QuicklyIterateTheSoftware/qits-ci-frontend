import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks, provideQitsScope } from '@qits/ui-components';
import { App } from './app';
import { routes } from './app.routes';

/**
 * A fixture navigation, not the platform's. `provideQitsNavigationLinks` answers the layout's
 * `QITS_NAVIGATION` from a literal, so the chrome never asks for `/main-navigation` — no request to
 * flush, and nothing pending to keep the harness from settling.
 */
const NAV = [
  { label: 'CI', href: 'https://ci.dev.example.test/' },
  { label: 'Deployments', href: 'https://deployments.dev.example.test/' },
  { label: 'Artifacts', href: 'https://registry.dev.example.test/' },
] as const;

/**
 * The shell owns one thing — the outlet — so that is what is asserted here, plus the route table
 * actually reaching the shared layout behind `''`. What the layout itself renders is
 * @qits/ui-components' own specs' business; this only checks that the root route gets it.
 */
describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      // The root route is now the tree, and the tree reads two services on arrival — so this
      // suite needs a backend even though what it asserts is the shell and the chrome.
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks(NAV),
        provideQitsScope('repository'),
      ],
    });
  });

  it('is an outlet and nothing else', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    expect(shell.querySelector('h1')).toBeNull();
  });

  it('routes the root URL to the shared layout', async () => {
    const harness = await RouterTestingHarness.create('/');
    const layout = harness.routeNativeElement as HTMLElement;

    // The count is the fixture's, not the platform's: how many front doors exist is a deployment
    // fact the edge answers, and asserting it belongs to the edge's own spec. What this proves is
    // that the root route mounts the chrome and the chrome renders what it is told.
    expect(layout.querySelectorAll('.qits-layout-link')).toHaveLength(NAV.length);
    // The layout carries the outlet the pages of this SPA will one day render into.
    expect(layout.querySelector('main.qits-layout-content router-outlet')).not.toBeNull();
  });
});
