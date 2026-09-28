import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CiRunnerDto } from '../api/dto';
import { RunnersPage } from './runners-page';

/**
 * The runners page: the list, the once-only install-script panel, and a delete a runner still
 * holding a run refuses.
 *
 * The address forms — `/runners` at the root only, and `isRepositoryAddress` refusing to read it as
 * a project — are asserted in `app.routes.spec.ts`, which is where every other address form this
 * application answers already lives.
 */
describe('RunnersPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RunnersPage>;

  const runner = (over: Partial<CiRunnerDto> = {}): CiRunnerDto => ({
    id: 'r1',
    name: 'build-box-1',
    description: null,
    slots: 2,
    plane: 'INTERNAL',
    capabilities: null,
    registered: true,
    connected: true,
    heldRuns: 0,
    lastSeenAt: new Date(Date.now() - 5_000).toISOString(),
    createdAt: '2026-07-31T14:02:11Z',
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function mount(): void {
    fixture = TestBed.createComponent(RunnersPage);
  }

  /**
   * Several rounds, not one: Angular's zoneless change-detection scheduler races a `setTimeout`
   * against a `requestAnimationFrame`, so a single microtask turn is not always enough for a signal
   * written inside a promise callback to reach the DOM — see the same note in `active-runs.spec.ts`.
   */
  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function buttons(label: string): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button, qits-button button'),
    ).filter((button) => (button.textContent ?? '').trim() === label) as HTMLButtonElement[];
  }

  function flushRunners(runners: readonly CiRunnerDto[]): void {
    http.expectOne('/ci/api/runners').flush({ runners });
  }

  it('lists a runner: name, connectivity, slots, held, plane and a relative last-seen', async () => {
    mount();
    flushRunners([runner()]);
    await settle();

    expect(text()).toContain('build-box-1');
    expect(text()).toContain('running'); // connected → the green "running" word
    expect(text()).toContain('2 slots');
    expect(text()).toContain('0 held');
    expect(text()).toContain('INTERNAL');
    expect(text()).toContain('seen 5s ago');
  });

  /** The three connectivity states, each in the vocabulary the run rows already use for a badge. */
  it('draws the three connectivity states in the run rows’ own badge vocabulary', async () => {
    mount();
    flushRunners([
      runner({ id: 'r1', name: 'connected-one', connected: true, registered: true }),
      runner({ id: 'r2', name: 'away-one', connected: false, registered: true }),
      runner({ id: 'r3', name: 'never-one', connected: false, registered: false }),
    ]);
    await settle();

    expect(text()).toContain('running');
    expect(text()).toContain('queued');
    expect(text()).toContain('never started');
  });

  it('draws capabilities as chips', async () => {
    mount();
    flushRunners([
      runner({
        capabilities: { docker: true, os: 'linux', arch: 'amd64', runnerVersion: '1.2.3' },
      }),
    ]);
    await settle();

    const chips = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.chip'),
    ).map((chip) => chip.textContent?.trim());
    expect(chips).toEqual(['docker', 'linux', 'amd64', 'v1.2.3']);
  });

  it('says there are no runners rather than drawing an empty list', async () => {
    mount();
    flushRunners([]);
    await settle();

    expect(text()).toContain('No runners are registered yet.');
  });

  // --- registering a runner and the once-only install-script panel ---

  function setValue(selector: string, value: string): void {
    const input = (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function setSelectValue(selector: string, value: string): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }

  it('rejects a name the server rule would also refuse, before any request is made', async () => {
    mount();
    flushRunners([]);
    await settle();

    setValue('.create input[type="text"]', 'Not-Lowercase');
    buttons('Register')[0].click();
    await settle();

    expect(text()).toContain('Lowercase letters, digits and hyphens, starting with a letter.');
    // No POST was ever sent — http.verify() in afterEach would fail if one had been.
  });

  it('defaults the create form’s plane choice to EDGE', async () => {
    mount();
    flushRunners([]);
    await settle();

    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '.create select',
    ) as HTMLSelectElement;
    expect(select.value).toBe('EDGE');
    expect(text()).toContain(
      'EDGE: steps on this runner reach the platform through its public names with a job token',
    );
  });

  it('sends the chosen plane, INTERNAL, when it is changed away from the EDGE default', async () => {
    mount();
    flushRunners([]);
    await settle();

    setValue('.create input[type="text"]', 'build-box-internal');
    setSelectValue('.create select', 'INTERNAL');
    buttons('Register')[0].click();
    await settle();

    const request = http.expectOne('/ci/api/runners');
    expect(request.request.body).toEqual({
      name: 'build-box-internal',
      description: null,
      slots: 1,
      plane: 'INTERNAL',
    });
    request.flush(
      { ...runner({ id: 'r9', name: 'build-box-internal' }), installScript: 'x' },
      { status: 201, statusText: 'Created' },
    );
    await settle();
    flushRunners([runner({ id: 'r9', name: 'build-box-internal' })]);
    await settle();
  });

  it('renders qits-ci’s EDGE_PLANE_UNCONFIGURED 400 as the domain-not-configured sentence', async () => {
    mount();
    flushRunners([]);
    await settle();

    setValue('.create input[type="text"]', 'build-box-edge');
    buttons('Register')[0].click();
    await settle();

    http
      .expectOne('/ci/api/runners')
      .flush(
        { message: 'EDGE_PLANE_UNCONFIGURED' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    expect(text()).toContain(
      "The platform's public domain is not configured in qits-ci (QITS_DOMAIN).",
    );
  });

  it('sends the edited plane, alongside slots and description, when a row is saved', async () => {
    mount();
    flushRunners([runner({ plane: 'EDGE' })]);
    await settle();

    buttons('Actions')[0].click();
    await settle();
    buttons('Edit slots/description')[0].click();
    await settle();
    setSelectValue('.edit select', 'INTERNAL');
    buttons('Save')[0].click();
    await settle();

    const request = http.expectOne('/ci/api/runners/r1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ slots: 2, description: null, plane: 'INTERNAL' });
    request.flush(runner({ plane: 'INTERNAL' }));
    await settle();
    flushRunners([runner({ plane: 'INTERNAL' })]);
    await settle();
  });

  it('opens the install-script panel on a successful registration, with the two required sentences', async () => {
    mount();
    flushRunners([]);
    await settle();

    setValue('.create input[type="text"]', 'build-box-2');
    buttons('Register')[0].click();
    await settle();

    const request = http.expectOne('/ci/api/runners');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'build-box-2',
      description: null,
      slots: 1,
      plane: 'EDGE',
    });
    request.flush(
      { ...runner({ id: 'r2', name: 'build-box-2' }), installScript: '#!/bin/sh\necho hi\n' },
      { status: 201, statusText: 'Created' },
    );
    await settle();
    flushRunners([runner({ id: 'r2', name: 'build-box-2' })]);
    await settle();

    expect(text()).toContain('Install script — build-box-2');
    expect(text()).toContain('#!/bin/sh');
    expect(text()).toContain('Paste this into a terminal on the server. Nothing else is needed.');
    expect(text()).toContain('This is the only time it is shown');
  });

  it('copies the install script to the clipboard and confirms it, without ever reading the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, readText: vi.fn() },
      configurable: true,
    });

    mount();
    flushRunners([]);
    await settle();
    setValue('.create input[type="text"]', 'build-box-3');
    buttons('Register')[0].click();
    await settle();
    http
      .expectOne('/ci/api/runners')
      .flush(
        { ...runner({ id: 'r3', name: 'build-box-3' }), installScript: 'THE-SCRIPT' },
        { status: 201, statusText: 'Created' },
      );
    await settle();
    flushRunners([runner({ id: 'r3', name: 'build-box-3' })]);
    await settle();

    buttons('Copy')[0].click();
    await settle();

    expect(writeText).toHaveBeenCalledWith('THE-SCRIPT');
    expect(writeText).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
    expect((navigator.clipboard as unknown as { readText: unknown }).readText).not.toHaveBeenCalled();
    expect(text()).toContain('Copied');
  });

  it('drops the install script when the panel is closed — it is shown once and nowhere else', async () => {
    mount();
    flushRunners([]);
    await settle();
    setValue('.create input[type="text"]', 'build-box-4');
    buttons('Register')[0].click();
    await settle();
    http
      .expectOne('/ci/api/runners')
      .flush(
        { ...runner({ id: 'r4', name: 'build-box-4' }), installScript: 'ONE-TIME-SCRIPT' },
        { status: 201, statusText: 'Created' },
      );
    await settle();
    flushRunners([runner({ id: 'r4', name: 'build-box-4' })]);
    await settle();
    expect(text()).toContain('ONE-TIME-SCRIPT');

    buttons('Close')[0].click();
    await settle();

    expect(text()).not.toContain('ONE-TIME-SCRIPT');
    expect(text()).not.toContain('Install script');
  });

  // --- the row menu: delete, and the 409 it can answer ---

  it('offers no delete when a runner holds a run, and says why', async () => {
    mount();
    flushRunners([runner({ heldRuns: 3 })]);
    await settle();

    buttons('Actions')[0].click();
    await settle();

    expect(text()).toContain('This runner holds 3 runs right now.');
    const deleteButton = buttons('Delete')[0];
    expect(deleteButton.disabled).toBe(true);
  });

  it('renders a 409 the delete answers, verbatim, rather than a generic failure', async () => {
    mount();
    flushRunners([runner({ heldRuns: 0 })]);
    await settle();

    buttons('Actions')[0].click();
    await settle();
    buttons('Delete')[0].click();
    await settle();
    buttons('Yes, delete it')[0].click();
    await settle();

    const request = http.expectOne('/ci/api/runners/r1');
    expect(request.request.method).toBe('DELETE');
    request.flush(
      { message: 'This runner still holds 1 run' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(text()).toContain('409 This runner still holds 1 run');
  });

  it('deletes a runner with no runs held and refreshes the list', async () => {
    mount();
    flushRunners([runner({ heldRuns: 0 })]);
    await settle();

    buttons('Actions')[0].click();
    await settle();
    buttons('Delete')[0].click();
    await settle();
    buttons('Yes, delete it')[0].click();
    await settle();

    http.expectOne('/ci/api/runners/r1').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    flushRunners([]);
    await settle();

    expect(text()).toContain('No runners are registered yet.');
  });
});
