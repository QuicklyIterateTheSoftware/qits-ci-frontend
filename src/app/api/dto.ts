/**
 * The wire shapes this client reads, hand-written and copied field-for-field from the Java records
 * on the other side (`CiRunDto`, `CiStepDto`, `CiLiveStepDto` in qits-ci; `ProjectDto`,
 * `RepositoryDto` in qits-projects).
 *
 * Hand-written rather than generated, deliberately. The platform generates OpenAPI *documents*, not
 * clients, and every controller here nests its request/response records inside the request type, so
 * a generator names them positionally — qits-projects' committed document already calls the
 * list-projects response `Response19` and one entry `Entry4`. A tree written against `Entry4` is
 * worse than one written against the twenty lines below, and the total surface is seven endpoints.
 *
 * The response envelopes are genuinely inconsistent between the two services — `{runs: […]}` for
 * ci's list, a bare run for its single read, `{entries: [{project: …}]}` for projects — and the
 * interfaces say so rather than pretending otherwise. Straightening them out is the servers'
 * business, not this client's.
 *
 * `Instant` arrives as an ISO-8601 string; every timestamp below is typed as one and parsed only
 * where it is formatted.
 */

/**
 * A run's outcome.
 *
 * `QUEUED` and `RUNNING` are the two non-terminal ones — a run is accepted and recorded before a
 * daemon picks it up — and that pair is what every poll on this client keys off. `QUEUED` arrived
 * with the active-runs list: a platform-wide "what is in flight" is only true if it counts the runs
 * that have not started yet, and a run waiting for a daemon is exactly the thing an operator wants
 * to see before it becomes a wait they are wondering about.
 */
export type CiRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'CONFIG_ERROR';

/** A step's outcome. `PENDING` and `RUNNING` are legacy on this enum and never written. */
export type CiStepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

/** What caused a run: a push, or an event that matched a committed trigger. */
export type CiTriggerType = 'POST_RECEIVE' | 'EVENT';

/**
 * What a repository is for, as qits-projects classifies it.
 *
 * Widened additively: `DAEMON`, `FRONTEND`, `CLI` and `IMAGE` are the new names.
 */
export type RepositoryArchetype =
  | 'PROJECT'
  | 'SERVICE'
  | 'LIBRARY'
  | 'SERVICE_TEMPLATE'
  | 'FORK'
  | 'DAEMON'
  | 'FRONTEND'
  | 'CLI'
  | 'IMAGE';

/** Trigger types in the order they are drawn; a group with no runs is not drawn at all. */
export const CI_TRIGGER_TYPES: readonly CiTriggerType[] = ['POST_RECEIVE', 'EVENT'];

/** The statuses a run can still leave. Everything else is final and nothing further will change. */
const NON_TERMINAL: ReadonlySet<CiRunStatus> = new Set<CiRunStatus>(['QUEUED', 'RUNNING']);

/**
 * A run is over when it can no longer change — the whole rule behind Decision 5's poll.
 *
 * `QUEUED` counts as in flight, not as finished. A run page opened on a queued run must keep
 * reading until a daemon takes it, or it would sit on `QUEUED` forever while the build ran.
 */
export function isTerminal(status: CiRunStatus): boolean {
  return !NON_TERMINAL.has(status);
}

/**
 * One finished step. A step only ever appears already finished: while it runs it has no row, and
 * the run's `live` carries its output instead. `output` is populated on the single-run read only,
 * and is null in listings.
 */
export interface CiStepDto {
  readonly stepIndex: number;
  readonly image: string;
  readonly status: CiStepStatus;
  readonly exitCode: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly output: string | null;
}

/**
 * The step executing right now — two fields, and that is all it has. No image, no timestamps, no
 * status, because the relay it comes from holds none. A renderer must not invent them.
 */
export interface CiLiveStepDto {
  readonly stepIndex: number;
  readonly output: string;
}

/**
 * A CI run. `steps` is null in listings; `live` is non-null only while `status` is `RUNNING`.
 *
 * `repoId` is the **storage** id — an opaque key, and the one every run is found and grouped by.
 * `projectId` and `repoName` are the repository's **public** coordinate, the pair that spells its
 * address `/git/<projectId>/<repoName>`, and they are additive rather than a replacement. Both are
 * null on a run whose push was id-addressed and on every run recorded before the identity campaign,
 * so a reader is labelled by `repoName` when it is there and by `repoId` when it is not — see
 * {@link runRepositoryLabel}. Keys never move: a query, a route and a map stay on `repoId`.
 */
export interface CiRunDto {
  readonly id: string;
  readonly repoId: string;
  readonly projectId: string | null;
  readonly repoName: string | null;
  readonly branch: string;
  readonly commitSha: string;
  readonly status: CiRunStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly cancellationReason: string | null;
  readonly supersededByRunId: string | null;
  readonly daemonVersion: string | null;
  readonly triggerType: CiTriggerType;
  readonly triggerEventId: string | null;
  readonly triggerEventName: string | null;
  readonly configPath: string | null;
  readonly steps: readonly CiStepDto[] | null;
  readonly live: CiLiveStepDto | null;
}

/**
 * The repository ids qits-ci has runs for. Storage ids it *observed*, not repositories it owns.
 *
 * Bare strings, so there is no name in here at all. A row drawn from this list takes its label from
 * the matching {@link CiRepositorySummaryDto}, which carries the name the newest run announced.
 */
export interface CiRepositoriesResponse {
  readonly repositoryIds: readonly string[];
}

/** ci's list envelope, shared by the per-repository listing and the platform-wide active list. */
export interface CiRunsResponse {
  readonly runs: readonly CiRunDto[];
}

/**
 * One repository's headline runs: its latest run on any branch, and the latest on its main branch.
 *
 * Either field is null when qits-ci has no such run, and a repository with no runs at all has no
 * entry in the response. Both absences mean the same thing on screen — **no badge** — because a
 * placeholder badge on a repository that has never built would be an invented status, and the whole
 * point of these two badges is that they report.
 *
 * `projectId` and `repoName` are read off the newest run rather than stored anywhere — qits-ci owns
 * no repository row, so what it knows about a name is whatever the last push told it — and are null
 * when that run carried none.
 */
export interface CiRepositorySummaryDto {
  readonly repositoryId: string;
  readonly projectId: string | null;
  readonly repoName: string | null;
  readonly lastRun: CiRunDto | null;
  readonly lastMainRun: CiRunDto | null;
}

/** The summary envelope, ascending by repository id. */
export interface CiRepositorySummariesResponse {
  readonly repositories: readonly CiRepositorySummaryDto[];
}

/** A project's dns record, or the whole object is null when it registers no domain. */
export interface ProjectDnsRecordDto {
  readonly domain: string;
  readonly type: string;
  readonly value: string;
}

/** A project. `slug` is the immutable git-safe identity; `name` is the editable display one. */
export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly dns: ProjectDnsRecordDto | null;
}

/**
 * A repository. `name` is the registered name and the tree's label; `id` stays the identity, because
 * `id` is the git host's opaque storage key and therefore the join key `CiRun.repoId` carries.
 *
 * The pair `(projectId, name)` is the repository's public address; `id` is addressable by nobody
 * outside qits-projects. So `name` is what a person reads and `id` is what this client joins on,
 * and neither stands in for the other.
 *
 * `name` is typed nullable rather than required: release A added the column without backfilling
 * every row, so a row written earlier can still answer null — see {@link repositoryLabel} for what
 * is drawn then.
 */
export interface RepositoryDto {
  readonly id: string;
  readonly name: string | null;
  /** The clone url. */
  readonly backupUrl: string;
  readonly mainBranch: string;
  readonly archetype: RepositoryArchetype;
  readonly projectId: string;
}

/** projects' list envelope: entries, each wrapping the thing it lists. */
export interface ProjectEntriesResponse {
  readonly entries: readonly { readonly project: ProjectDto }[];
}

/** The same envelope, one level down. */
export interface RepositoryEntriesResponse {
  readonly entries: readonly { readonly repository: RepositoryDto }[];
}
