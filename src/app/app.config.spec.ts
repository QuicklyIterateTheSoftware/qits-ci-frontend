import { HttpBackend, HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
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
});
