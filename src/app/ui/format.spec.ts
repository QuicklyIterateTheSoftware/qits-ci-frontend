import {
  NONE,
  formatClock,
  formatDayTime,
  formatDuration,
  formatElapsed,
  formatEta,
  formatInstant,
  repositoryLabel,
  runRepositoryLabel,
  shortId,
  shortSha,
  stripAnsi,
} from './format';

describe('format', () => {
  it('renders timestamps in UTC, so two people reading one run agree', () => {
    expect(formatDayTime('2026-07-31T14:02:11Z')).toBe('31 Jul 14:02');
    expect(formatInstant('2026-07-31T14:02:11Z')).toBe('31 Jul 2026 14:02:11Z');
    expect(formatClock('2026-07-31T14:06:23Z')).toBe('14:06:23');
  });

  it('draws one em dash where there is nothing to draw', () => {
    expect(formatDayTime(null)).toBe(NONE);
    expect(formatInstant('not a date')).toBe(NONE);
    expect(formatDuration(null, null)).toBe(NONE);
  });

  it('counts an unfinished span against the clock it is given', () => {
    const started = '2026-07-31T15:20:00Z';
    const now = Date.parse('2026-07-31T15:22:07Z');
    expect(formatDuration(started, null, now)).toBe('2m 07s');
    expect(formatDuration(started, '2026-07-31T15:24:12Z')).toBe('4m 12s');
  });

  it('reads seconds, minutes and hours the way a build log does', () => {
    expect(formatElapsed(41_000)).toBe('41s');
    expect(formatElapsed(252_000)).toBe('4m 12s');
    expect(formatElapsed(3_840_000)).toBe('1h 04m');
  });

  /**
   * The exact strings, pinned, because the wording *is* the feature. A prediction spelled the way a
   * measurement is spelled borrows the measurement's authority, so every one of these is hedged and
   * every one of them is coarse — and none of them is ever a clock time, which is the promise the
   * epic explicitly refuses to make.
   */
  describe('formatEta', () => {
    it('hedges to the minute below an hour and a half', () => {
      expect(formatEta(2_880_000)).toBe('in about 48 min');
      expect(formatEta(60_000)).toBe('in about 1 min');
      expect(formatEta(5_340_000)).toBe('in about 89 min');
    });

    it('rounds to the minute rather than reporting seconds it does not know', () => {
      expect(formatEta(127_000)).toBe('in about 2 min');
      expect(formatEta(155_000)).toBe('in about 3 min');
    });

    /** An estimate reaching hours has error measured in the same units; a minute on it is noise. */
    it('coarsens to the half hour once it reaches an hour and a half', () => {
      expect(formatEta(5_400_000)).toBe('in about 1h 30m');
      expect(formatEta(7_200_000)).toBe('in about 2h');
      expect(formatEta(10_080_000)).toBe('in about 3h');
      expect(formatEta(9_000_000)).toBe('in about 2h 30m');
    });

    /** There is no useful number under a minute, and none at all once the estimate is overtaken. */
    it('says under a minute, and says any moment now once the instant has passed', () => {
      expect(formatEta(41_000)).toBe('in under a minute');
      expect(formatEta(1)).toBe('in under a minute');
      expect(formatEta(0)).toBe('any moment now');
      expect(formatEta(-90_000)).toBe('any moment now');
      expect(formatEta(Number.NaN)).toBe('any moment now');
    });

    /** It is never a clock time: "at 14:32" is a commitment, and it is wrong the moment the queue moves. */
    it('never spells a wall clock', () => {
      for (const millis of [0, 41_000, 2_880_000, 10_080_000]) {
        expect(formatEta(millis)).not.toMatch(/\d:\d/);
      }
    });
  });

  it('labels a repository by its registered name, never by its id', () => {
    expect(
      repositoryLabel({ name: 'qits-ci', backupUrl: 'https://example.test/QuicklyIterate/x.git' }),
    ).toBe('qits-ci');
  });

  /** Release A added the name column without backfilling, so an old row still labels itself. */
  it('falls back to the basename of the clone url when a row has no name', () => {
    const label = (backupUrl: string) => repositoryLabel({ name: null, backupUrl });

    expect(label('https://github.com/QuicklyIterate/qits-ci.git')).toBe('qits-ci');
    expect(label('git@github.com:QuicklyIterate/qits-ci.git')).toBe('qits-ci');
    expect(label('/data/repositories/qits-gateway/origin/')).toBe('origin');
  });

  it('labels a run by the repository name it announced', () => {
    expect(
      runRepositoryLabel({ repoId: '3f6c1a9e-0b25-4d1e-9c77-2a0e5b8f4d31', repoName: 'qits-ci' }),
    ).toBe('qits-ci');
  });

  /**
   * A mirror sync and every run older than the identity campaign carry no name. The storage id is
   * the only true thing left to draw, and an empty string from a serialiser counts as no name.
   */
  it('falls back to the storage id for a run that announced no name', () => {
    const id = '3f6c1a9e-0b25-4d1e-9c77-2a0e5b8f4d31';

    expect(runRepositoryLabel({ repoId: id, repoName: null })).toBe(id);
    expect(runRepositoryLabel({ repoId: id, repoName: '' })).toBe(id);
  });

  /** A row with neither field draws no label — it must not throw and empty the tree around it. */
  it('draws an empty label rather than throwing when a row has no url either', () => {
    const missing = { name: null, backupUrl: undefined } as unknown as Parameters<
      typeof repositoryLabel
    >[0];

    expect(repositoryLabel(missing)).toBe('');
  });

  it('abbreviates ids and shas the way the rows need them', () => {
    expect(shortId('da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61')).toBe('da4a3f0e');
    expect(shortSha('9f2c1ab3d4e5f6')).toBe('9f2c1ab');
  });

  it('strips ANSI escapes rather than interpreting them — this is a log pane, not a terminal', () => {
    const esc = '\u001b';
    const coloured = `${esc}[32mBUILD SUCCESS${esc}[0m in ${esc}[1m41s${esc}[22m`;
    expect(stripAnsi(coloured)).toBe('BUILD SUCCESS in 41s');
  });

  it('keeps the truncation marker verbatim — the head is gone and cannot be fetched', () => {
    const output = '[... output truncated ...]\nadded 812 packages in 41s\n';
    expect(stripAnsi(output)).toContain('[... output truncated ...]');
  });
});
