import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

/**
 * The shell owns one thing — the outlet — so that is what is asserted here, plus the route table
 * actually reaching the shared layout behind `''`. What the layout itself renders is
 * @qits/ui-components' own specs' business; this only checks that /ci/ gets it.
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

    expect(layout.querySelectorAll('.qits-layout-link')).toHaveLength(7);
    // The layout carries the outlet the pages of this SPA will one day render into.
    expect(layout.querySelector('main.qits-layout-content router-outlet')).not.toBeNull();
  });
});
