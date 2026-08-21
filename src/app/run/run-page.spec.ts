import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { CiRunDto, CiStepDto, ProjectDto } from '../api/dto';
import { POLL_INTERVAL_MS } from './run-page';

/**
 * The run page, and above all the poll.
 *
 * A poll that never stops is the failure mode that will not show up in review: the page looks
 * right, the run is finished, and the tab quietly re-reads up to 320 KiB every three seconds
 * forever. So the two load-bearing assertions here are negative — no request after a terminal
 * status, and no request while the tab is hidden — and both are made with fake timers so they are
 * about the schedule rather than about wall-clock luck.
 *
 * Every spec answers the attribution lookup as well as the run read, because the page asks for both
 * at once: the run is the page, and the project that claims its repository is what makes the link
 * back into the tree land somewhere useful.
 */
describe('RunPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const step = (stepIndex: number, over: Partial<CiStepDto> = {}): CiStepDto => ({
    stepIndex,
    image: 'qits/build-images/node-base:latest',
    status: 'SUCCESS',
    exitCode: 0,
    startedAt: '2026-07-31T14:02:12Z',
    finishedAt: '2026-07-31T14:04:53Z',
    output: 'added 812 packages in 41s\n',
    ...over,
  });

  const run = (over: Partial<CiRunDto> = {}): CiRunDto => ({
    id: 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61',
    repoId: 'qits-ci',
    projectId: null,
    repoName: null,
    branch: 'main',
    commitSha: '9f2c1ab3d4e5',
    status: 'SUCCESS',
    createdAt: '2026-07-31T14:02:11Z',
    startedAt: '2026-07-31T14:02:12Z',
    finishedAt: '2026-07-31T14:06:23Z',
    cancellationReason: null,
    supersededByRunId: null,
    daemonVersion: '0.4.1',
    triggerType: 'POST_RECEIVE',
    triggerEventId: null,
    triggerEventName: null,
    configPath: '.config/qits/ci-post-receive.yml',
    steps: [step(0)],
    live: null,
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  async function open(runId = 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61'): Promise<void> {
    harness = await RouterTestingHarness.create(`/runs/${runId}`);
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(page().querySelectorAll('button'));
  }

  async function click(label: string): Promise<void> {
    const target = buttons().find((button) => (button.textContent ?? '').includes(label));
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  /**
   * Let the flushed responses land, their signals write, and change detection run.
   *
   * The rounds drain microtasks as well as waiting for stability, because the attribution lookup is
   * a promise chain four links long — a flushed response, a mapped envelope, a `Promise.all`, and
   * the awaiting page — and an app that is *stable* is not the same as one whose promises have all
   * settled. Too few rounds here reads as a component that never rendered its answer.
   */
  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function expectRun(runId = 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61') {
    return http.expectOne(`/ci/api/runs/${runId}`);
  }

  const project = (id: string, name: string): ProjectDto => ({
    id,
    name,
    slug: name,
    description: null,
    dns: null,
  });

  /**
   * Answer the attribution lookup: the project list, then each project's repositories. `claims`
   * maps a project id to the repository ids it owns, and the default is the platform's own shape —
   * a `qits` project that claims `qits-ci`.
   */
  async function flushAttribution(
    claims: Readonly<Record<string, readonly string[]>> = { p1: ['qits-ci'] },
  ): Promise<void> {
    const projects = Object.keys(claims).map((id) => project(id, id === 'p1' ? 'qits' : id));
    http
      .expectOne('/projects/api/projects')
      .flush({ entries: projects.map((entry) => ({ project: entry })) });
    await settle();
    for (const entry of projects) {
      http.expectOne(`/projects/api/projects/${entry.id}/repositories`).flush({
        entries: (claims[entry.id] ?? []).map((repoId) => ({
          repository: {
            id: repoId,
            name: repoId,
            backupUrl: `https://example.test/QuicklyIterate/${repoId}.git`,
            mainBranch: 'main',
            archetype: 'SERVICE',
            projectId: entry.id,
          },
        })),
      });
    }
    await settle();
  }

  /**
   * `document.hidden` is a getter on the prototype and jsdom does not let a test assign it, so the
   * visibility a spec needs is defined onto the document itself.
   */
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  }

  /**
   * Only `setInterval` is faked, and that is deliberate. Angular's zoneless change-detection
   * scheduler races a `setTimeout` against a `requestAnimationFrame`, so faking those would freeze
   * rendering itself and `whenStable()` would never resolve. The poll is the only thing this suite
   * needs control of.
   */
  function useIntervalFakes(): void {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  }

  async function tick(millis: number): Promise<void> {
    vi.advanceTimersByTime(millis);
    await settle();
  }

  it('renders the run, its provenance and its steps', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();

    expect(text()).toContain('qits-ci');
    expect(text()).toContain('9f2c1ab');
    expect(text()).toContain('SUCCESS');
    expect(text()).toContain('31 Jul 2026 14:02:11Z');
    expect(text()).toContain('.config/qits/ci-post-receive.yml');
    expect(text()).toContain('0.4.1');
    // The last completed step's pane is the one open on arrival.
    expect(page().querySelector('.output')?.textContent).toContain('added 812 packages');
    http.verify();
  });

  it('shows why a run was cancelled and links a deduped run to its replacement', async () => {
    await open();
    expectRun().flush(
      run({
        status: 'FAILED',
        cancellationReason: 'DEDUPED',
        supersededByRunId: 'newer-run',
      }),
    );
    await settle();
    await flushAttribution();

    expect(text()).toContain('DEDUPED');
    const replacement = Array.from(page().querySelectorAll('a')).find((link) =>
      link.textContent?.includes('newer run'),
    );
    expect(replacement?.getAttribute('href')).toBe('/runs/newer-run');
    http.verify();
  });

  it('renders a run id that resolves to nothing as a sentence, not a crash', async () => {
    await open('nope');
    http
      .expectOne('/ci/api/runs/nope')
      .flush({ message: 'No such run' }, { status: 404, statusText: 'Not Found' });
    await settle();
    await flushAttribution();

    expect(text()).toContain('No run nope.');
    expect(page().querySelector('a[href="/"]')).not.toBeNull();
  });

  it('offers a retry when the read fails for any other reason', async () => {
    await open();
    expectRun().flush(null, { status: 503, statusText: 'Down' });
    await settle();
    await flushAttribution();

    expect(text()).toContain('Could not load this run — 503');
    await click('Retry');
    expectRun().flush(run());
    await settle();

    expect(text()).toContain('SUCCESS');
  });

  it('does not poll a terminal run at all', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();

    await tick(POLL_INTERVAL_MS * 4);
    http.verify();
  });

  it('polls a RUNNING run every three seconds, and stops on the first terminal answer', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(
      run({
        status: 'RUNNING',
        finishedAt: null,
        live: { stepIndex: 1, output: '#14 DONE 2.4s\n' },
      }),
    );
    await settle();
    await flushAttribution();

    // The live step is drawn from two fields and invents nothing else.
    expect(text()).toContain('(step 1 · live)');
    expect(text()).toContain('#14 DONE 2.4s');
    expect(text()).toContain('following');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(
      run({ status: 'RUNNING', finishedAt: null, live: { stepIndex: 1, output: 'more\n' } }),
    );
    await settle();
    expect(text()).toContain('more');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();

    // Terminal: the answer is already complete, so nothing further is read. Ever.
    await tick(POLL_INTERVAL_MS * 5);
    http.verify();
    expect(text()).not.toContain('following');
  });

  /**
   * `QUEUED` is in flight, not finished. A page that treated it as terminal would sit on the word
   * QUEUED while the build ran to completion behind it — which is the same failure as never polling,
   * arrived at from the other direction.
   */
  it('keeps reading a QUEUED run until a daemon picks it up', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'QUEUED', finishedAt: null, steps: [], live: null }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('QUEUED');
    // Nothing has started, so nothing invents a step — and no cancel, which is a running run's.
    expect(text()).not.toContain('This run recorded no steps.');
    expect(buttons().some((button) => (button.textContent ?? '').includes('Cancel run'))).toBe(
      false,
    );

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    expect(text()).toContain('RUNNING');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();

    await tick(POLL_INTERVAL_MS * 3);
    http.verify();
  });

  it('pauses while the tab is hidden and reads once when it comes back', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    await tick(POLL_INTERVAL_MS * 3);
    http.verify(); // a hidden tab polls nothing

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();
    http.verify();
  });

  it('keeps the last good run on screen when a poll fails', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('last read failed');
    expect(text()).toContain('qits-ci');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run());
    await settle();
    expect(text()).not.toContain('last read failed');
  });

  it('offers cancel on a RUNNING run only, and never on a terminal one', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();
    expect(buttons().some((button) => (button.textContent ?? '').includes('Cancel run'))).toBe(
      false,
    );
  });

  it('guards cancel with a confirmation, and reconciles from the next read', async () => {
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    expect(text()).toContain('Stop this run?');
    // The question alone sends nothing.
    http.verify();

    await click('Yes, cancel it');
    const cancel = http.expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/cancel');
    expect(cancel.request.method).toBe('POST');
    cancel.flush(null, { status: 202, statusText: 'Accepted' });
    await settle();

    // The state is never assumed: the run is re-read, and that is what turns the page terminal.
    expectRun().flush(run({ status: 'FAILED', finishedAt: '2026-07-31T14:07:00Z' }));
    await settle();

    expect(text()).toContain('FAILED');
    expect(buttons().some((button) => (button.textContent ?? '').includes('Cancel run'))).toBe(
      false,
    );
  });

  it('shrugs at a 409 — the run finished between the render and the click', async () => {
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    await click('Yes, cancel it');
    http
      .expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/cancel')
      .flush({ message: 'not running' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expectRun().flush(run());
    await settle();

    expect(text()).toContain('had already finished');
    expect(text()).toContain('SUCCESS');
  });

  it('backs out of the confirmation without sending anything', async () => {
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    await click('Keep running');

    expect(text()).not.toContain('Stop this run?');
    expect(buttons().some((button) => (button.textContent ?? '').includes('Cancel run'))).toBe(
      true,
    );
    http.verify();
  });

  /**
   * The optimistic banner is the one piece of state this page asserts rather than reads, so it is
   * also the one that can outlive its truth. Measured live: a cancel left "Cancelling…" on screen
   * beside a run that had already reconciled to FAILED, because nothing retired it.
   */
  it('retires the “Cancelling…” banner the moment the run reconciles to terminal', async () => {
    useIntervalFakes();
    await open();
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    await flushAttribution();

    await click('Cancel run');
    await click('Yes, cancel it');
    http
      .expectOne('/ci/api/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61/cancel')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await settle();

    // The read that follows the cancel still shows a running run: the banner is true, and stays.
    expectRun().flush(run({ status: 'RUNNING', finishedAt: null }));
    await settle();
    expect(text()).toContain('Cancelling');

    await tick(POLL_INTERVAL_MS);
    expectRun().flush(run({ status: 'FAILED', finishedAt: '2026-07-31T14:07:00Z' }));
    await settle();

    expect(text()).not.toContain('Cancelling');
    expect(text()).toContain('FAILED');
  });

  /** The repository link, which is the only anchor in the provenance block. */
  function repoLink(): HTMLAnchorElement | null {
    return page().querySelector('.facts a');
  }

  it('names the project that claims the repository, and points the tree at it', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    await flushAttribution();

    expect(text()).toContain('· project qits');
    expect(repoLink()?.getAttribute('href')).toBe('/?project=p1&repo=qits-ci');
  });

  it('says so when no project claims the repository, and links to it alone', async () => {
    await open();
    expectRun().flush(run({ repoId: 'legacy-build-box' }));
    await settle();
    await flushAttribution();

    expect(text()).toContain('· not claimed by any project');
    expect(repoLink()?.getAttribute('href')).toBe('/?repo=legacy-build-box');
  });

  /**
   * The public pair is what a person reads. The storage id stays the key underneath it — the
   * `?repo=` parameter is still the id, because that is what the tree is keyed by.
   */
  it('labels the run by the repository name it announced, and still keys the link by the id', async () => {
    const id = '3f6c1a9e-0b25-4d1e-9c77-2a0e5b8f4d31';
    await open();
    expectRun().flush(run({ repoId: id, projectId: 'p1', repoName: 'qits-ci' }));
    await settle();
    await flushAttribution({ p1: [id] });

    expect(text()).toContain('qits-ci');
    expect(text()).not.toContain(id);
    expect(repoLink()?.getAttribute('href')).toBe(`/?project=p1&repo=${id}`);
  });

  /**
   * A run that arrived by the public address knows its project first-hand, so the index is asked
   * only to turn that id into a name. Here it holds no repository at all and the attribution is
   * still right — which the id-keyed join alone could not have been.
   */
  it('takes the project from the run itself rather than from the repository join', async () => {
    await open();
    expectRun().flush(run({ projectId: 'p1', repoName: 'qits-ci' }));
    await settle();
    await flushAttribution({ p1: [] });

    expect(text()).toContain('· project qits');
    expect(text()).not.toContain('not claimed by any project');
  });

  /** The deep link survives a failed lookup when the run carried the project itself. */
  it('still points the tree at the project when the lookup failed but the run knew it', async () => {
    await open();
    expectRun().flush(run({ projectId: 'p1', repoName: 'qits-ci' }));
    await settle();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(repoLink()?.getAttribute('href')).toBe('/?project=p1&repo=qits-ci');
    // A project *name* it does not have, so it claims none — and denies none either.
    expect(text()).not.toContain('project qits');
    expect(text()).not.toContain('not claimed by any project');
  });

  it('claims nothing at all when the lookup itself fails', async () => {
    await open();
    expectRun().flush(run());
    await settle();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    // Neither an owner nor a denial: a request that never answered is not evidence of either.
    expect(text()).not.toContain('project qits');
    expect(text()).not.toContain('not claimed by any project');
    expect(repoLink()?.getAttribute('href')).toBe('/?repo=qits-ci');
  });
});
