import { HttpBackend, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { QITS_SIGN_IN, QitsTokens } from '@qits/angular';
import { firstValueFrom } from 'rxjs';
import { appConfig } from './app.config';

/**
 * The backend choice is invisible when it is wrong: the XHR one works perfectly and simply produces
 * client spans that never exist. So it is asserted here rather than discovered as a telemetry gap,
 * the same way spa-home asserts its own wiring.
 */
describe('appConfig', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });
  });

  it('provides an HttpClient on the fetch backend', () => {
    expect(TestBed.inject(HttpClient)).toBeTruthy();
    expect(TestBed.inject(HttpBackend).constructor.name).toContain('Fetch');
  });

  it('signs in with the qits-spa client', () => {
    expect(TestBed.inject(QITS_SIGN_IN).clientId).toBe('qits-spa');
  });

  /**
   * The cheap equivalent of asserting `withInterceptors([qitsBearerInterceptor])` is wired: a call
   * through the configured `HttpClient` to this app's own origin (always a platform URL,
   * `isPlatformUrl`'s same-origin branch) carries the bearer `QitsTokens` hands out.
   */
  it('puts the bearer on its own calls', async () => {
    const tokens = { accessToken: async () => 'A1' };
    TestBed.overrideProvider(QitsTokens, { useValue: tokens });
    TestBed.configureTestingModule({ providers: [provideHttpClientTesting()] });

    const client = TestBed.inject(HttpClient);
    const http = TestBed.inject(HttpTestingController);
    const answer = firstValueFrom(client.get('/ci/api/runs/active'));
    await Promise.resolve();
    const request = http.expectOne('/ci/api/runs/active');
    expect(request.request.headers.get('authorization')).toBe('Bearer A1');
    request.flush({ runs: [] });
    await answer;
  });
});
