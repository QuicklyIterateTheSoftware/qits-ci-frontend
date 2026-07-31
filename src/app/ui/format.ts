/**
 * The small conversions both pages need, kept out of the templates so they can be asserted
 * directly.
 *
 * Every timestamp is rendered in **UTC**. The services stamp `Instant`s, the run detail page shows
 * the same wall clock an operator reads in a log line, and a browser-local rendering would make two
 * people looking at the same run disagree about when it started. The `Z` on the long form says so
 * out loud.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** What is drawn where there is nothing to draw — one em dash, everywhere. */
export const NONE = '—';

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `31 Jul 14:02` — a tree row's timestamp, no year, because the tree is about recency. */
export function formatDayTime(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** `31 Jul 2026 14:02:11Z` — the run detail's provenance block, where the exact instant matters. */
export function formatInstant(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return (
    `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

/** `14:06:23` — the second timestamp of a pair, where the day is already on screen. */
export function formatClock(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * `4m 12s`, `1h 04m`, `41s`. `to` is null for something still running, in which case the caller
 * passes the current time — that is how a running run's duration ticks locally without a poll.
 */
export function formatDuration(from: string | null, to: string | null, nowMs?: number): string {
  const start = parse(from);
  if (!start) {
    return NONE;
  }
  const end = parse(to)?.getTime() ?? nowMs;
  if (end === undefined) {
    return NONE;
  }
  return formatElapsed(end - start.getTime());
}

/** The same rendering, for a span the client measured itself rather than read off two fields. */
export function formatElapsed(millis: number): string {
  const total = Math.max(0, Math.round(millis / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${pad(seconds)}s`;
  }
  return `${seconds}s`;
}

/**
 * The label for a repository row: the basename of its clone url.
 *
 * `RepositoryDto` carries no name, and a row reading `a1b2c3d4-5e6f-…` helps nobody. This is a
 * **label only** — the identity stays `repository.id`, because that id is the git-host directory
 * name and therefore the key `CiRun.repoId` joins on.
 */
export function repositoryLabel(url: string): string {
  const basename = url
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .filter((part) => part.length > 0)
    .pop();
  return basename ?? url;
}

/** The first eight characters of an id — enough to recognise a run, short enough for a row. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** The first seven characters of a sha, as git itself abbreviates. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * ANSI escape sequences are removed, not interpreted. Interpreting them is a terminal emulator's
 * job and this is a log pane; leaving them in prints `[32m` in the middle of a build line.
 */
const ANSI = new RegExp(
  '\u001b\\[[0-?]*[ -/]*[@-~]' + '|\u001b\\][^\u0007\u001b]*(?:\u0007|\u001b\\\\)',
  'g',
);

/** Step output as it should be read: the bytes qits-ci stored, minus the colour codes. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
