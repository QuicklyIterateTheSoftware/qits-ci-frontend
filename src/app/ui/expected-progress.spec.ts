import { TestBed } from '@angular/core/testing';
import {
  ExpectedProgress,
  hasExpectations,
  totalExpectedMillis,
  type ExpectedProgressRun,
} from './expected-progress';

/**
 * The bar is geometry plus one subtraction, and both halves are asserted here rather than eyeballed.
 *
 * The geometry is the part that cannot be checked by looking: the segments are shares of the total,
 * the gap between two steps is carved out of the one *before* it, and the last segment keeps its
 * whole share — which together are what makes the boundaries land where the steps actually change
 * instead of drifting right by a gap per step.
 *
 * The subtraction is elapsed-against-expected, and every assertion about it is a clamp: never below
 * empty, never past full, and a run that outlasts its own history holds at full and says so in tone
 * rather than growing off the end of the track.
 *
 * The last group is the one that matters for every run recorded before this field existed: no
 * expectations means **nothing drawn at all**, so a caller can mount this unconditionally.
 */
describe('ExpectedProgress', () => {
  /** A run in flight, 45 of its expected 100 seconds in, unless a spec says otherwise. */
  const run = (over: Partial<ExpectedProgressRun> = {}): ExpectedProgressRun => ({
    status: 'RUNNING',
    startedAt: new Date(Date.now() - 45_000).toISOString(),
    expectedStepDurationsMillis: [10_000, 90_000],
    ...over,
  });

  async function draw(value: ExpectedProgressRun): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(ExpectedProgress);
    fixture.componentRef.setInput('run', value);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function segments(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.segment'));
  }

  /** A percentage off an inline style, as a number — `9%` is what the template writes. */
  function percent(style: string): number {
    return parseFloat(style);
  }

  function widths(host: HTMLElement): number[] {
    return segments(host).map((segment) => percent(segment.style.width));
  }

  function lefts(host: HTMLElement): number[] {
    return segments(host).map((segment) => percent(segment.style.left));
  }

  function fills(host: HTMLElement): number[] {
    return segments(host).map((segment) =>
      percent(segment.querySelector<HTMLElement>('.fill')?.style.width ?? '0'),
    );
  }

  function valueNow(host: HTMLElement): string | null {
    return host.querySelector('.track')?.getAttribute('aria-valuenow') ?? null;
  }

  // --- the division ---

  /**
   * The product's own example, and the one number in it that is not obvious: 10s and 90s are 10% and
   * 90% of the run, and the bar draws 9%, a 1% gap, then 90% — the gap comes out of the step it
   * follows, so the boundary still sits at the 10% mark.
   */
  it('divides 10s + 90s into a 9% segment, a 1% gap and a 90% segment', async () => {
    const host = await draw(run({ status: 'QUEUED', startedAt: null }));

    expect(widths(host)).toEqual([9, 90]);
    expect(lefts(host)).toEqual([0, 10]);
  });

  it('carves the gap out of every segment but the last, which keeps its whole share', async () => {
    const host = await draw(
      run({ status: 'QUEUED', startedAt: null, expectedStepDurationsMillis: [1000, 1000, 1000] }),
    );

    // Three equal steps: 33.33% each, and only the third is drawn at its full share. The lefts are
    // the shares themselves, so the last segment still ends at the end of the track.
    expect(widths(host)).toEqual([32.33, 32.33, 33.33]);
    expect(lefts(host)).toEqual([0, 33.33, 66.67]);
  });

  /**
   * A step whose whole share is narrower than the gap cannot give the gap back, and a negative width
   * is not a thing. It clamps to zero and keeps its place in the layout, because what the division is
   * for is where the *other* boundaries are.
   */
  it('clamps a segment narrower than the gap to zero rather than a negative width', async () => {
    const host = await draw(
      run({ status: 'QUEUED', startedAt: null, expectedStepDurationsMillis: [10, 100_000] }),
    );

    expect(widths(host)[0]).toBe(0);
    expect(widths(host)[1]).toBeCloseTo(100, 1);
    expect(lefts(host)[1]).toBeGreaterThan(0);
  });

  // --- the fill ---

  it('fills left to right, completing the steps that are behind it', async () => {
    const host = await draw(run());

    // 45s into 100s: the first step (10s) is over, and the second is 35 of its 90 seconds in.
    expect(fills(host)[0]).toBe(100);
    expect(fills(host)[1]).toBeCloseTo(38.9, 0);
    expect(valueNow(host)).toBe('45');
  });

  it('shows the time actually taken beside the bar, ticking', async () => {
    const host = await draw(run());

    expect(host.textContent).toContain('45s');
  });

  /**
   * A queued run has the shape and has not started: an empty track is the honest drawing of that,
   * and the row above it is what says how long it has been waiting.
   */
  it('draws the empty track for a queued run, and no elapsed time', async () => {
    const host = await draw(run({ status: 'QUEUED', startedAt: null }));

    expect(host.querySelector('.track')).not.toBeNull();
    expect(fills(host)).toEqual([0, 0]);
    expect(valueNow(host)).toBe('0');
    expect(host.querySelector('.elapsed')).toBeNull();
  });

  /**
   * The expectation is a p95, not a deadline. Outlasting it is a statement about this run against its
   * own history, so the bar holds at full and shifts tone — it never grows past its track, because a
   * bar that rescaled itself could not be compared with the frame before it.
   */
  it('stays full and marks itself overdue once it outlasts the expectation', async () => {
    const host = await draw(run({ startedAt: new Date(Date.now() - 200_000).toISOString() }));

    expect(fills(host)).toEqual([100, 100]);
    expect(valueNow(host)).toBe('100');
    expect(host.querySelectorAll('.fill.overdue').length).toBe(2);
    expect(host.querySelector('.elapsed.overdue')).not.toBeNull();
  });

  it('is not overdue while it is merely most of the way through', async () => {
    const host = await draw(run({ startedAt: new Date(Date.now() - 99_000).toISOString() }));

    expect(host.querySelector('.overdue')).toBeNull();
  });

  // --- nothing to predict from ---

  it('draws nothing at all for a run that carries no expectations', async () => {
    for (const expected of [undefined, null, []]) {
      const host = await draw(run({ expectedStepDurationsMillis: expected }));
      expect(host.querySelector('.track')).toBeNull();
      expect(host.textContent?.trim()).toBe('');
    }
  });

  /**
   * One bad entry poisons the whole bar rather than one segment: every other step's boundary is a
   * share of the total, so a zero or a negative would silently move all of them. Drawing nothing is
   * the only honest answer.
   */
  it('draws nothing when an entry is not a positive duration', async () => {
    for (const expected of [[10_000, 0], [-1], [10_000, Number.NaN]]) {
      const host = await draw(run({ expectedStepDurationsMillis: expected }));
      expect(host.querySelector('.track')).toBeNull();
    }
  });

  describe('totalExpectedMillis', () => {
    it('sums the steps', () => {
      expect(totalExpectedMillis([10_000, 90_000])).toBe(100_000);
    });

    it('answers null for absence and for nonsense alike', () => {
      expect(totalExpectedMillis(undefined)).toBeNull();
      expect(totalExpectedMillis(null)).toBeNull();
      expect(totalExpectedMillis([])).toBeNull();
      expect(totalExpectedMillis([0])).toBeNull();
      expect(totalExpectedMillis([1000, -1])).toBeNull();
    });
  });

  describe('hasExpectations', () => {
    it('is the same question the component answers by drawing nothing', () => {
      expect(hasExpectations(run())).toBe(true);
      expect(hasExpectations(run({ expectedStepDurationsMillis: null }))).toBe(false);
      expect(hasExpectations(run({ expectedStepDurationsMillis: [] }))).toBe(false);
    });
  });
});
