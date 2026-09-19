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
 *
 * `TIMED_OUT` is terminal: a step hit its deadline — 30 minutes by default — so the daemon stopped
 * it, and the run carries that outcome.
 */
export type CiRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'CONFIG_ERROR'
  | 'TIMED_OUT';

/**
 * A step's outcome. `PENDING` and `RUNNING` are legacy on this enum and never written.
 *
 * `TIMED_OUT` is terminal, and the step it is written on is the one that hit its deadline.
 */
export type CiStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'TIMED_OUT';

/** What caused a run: a push, or an event that matched a committed trigger. */
export type CiTriggerType = 'POST_RECEIVE' | 'EVENT';

/**
 * Which phase of a release a run belongs to.
 *
 * A release is gated twice: `RELEASE_REQUEST` is phase one, the QA that decides whether the fold may
 * ship, and `RELEASE` is phase two, the build that actually publishes it. Both runs carry the same
 * `releaseRequestId`, so without this a client holding a request's runs could not tell them apart —
 * and "QA is still going" and "the publish is still going" are different answers to the only
 * question anybody is asking.
 */
export type CiRunPhase = 'RELEASE_REQUEST' | 'RELEASE';

/**
 * A run that has to go first, as qits-ci's ordering names it.
 *
 * `repoName` is a label and may be absent for exactly the reasons {@link runRepositoryLabel}
 * describes; `runId` is the identity and is always there.
 */
export interface CiOrderingBlockerDto {
  readonly runId: string;
  readonly repoName?: string | null;
}

/**
 * Why a queued run sits where it sits — qits-ci's claim ordering, shown rather than guessed at.
 *
 * Every field is qits-ci's own reasoning and none of it is re-derived here: a client that recomputed
 * the order would eventually disagree with the daemon that actually claims the runs, and a queue
 * explanation that contradicts the queue is worse than no explanation.
 *
 * `priority` and `selection` are **open strings**, treated the way `cancellationReason` already is: a
 * word this build has not been taught is a word qits-ci added, and printing it verbatim is more
 * honest than mapping it to a guess.
 */
export interface CiRunOrderingDto {
  /** 0-based place in the suggested claim order — the same index as {@link CiRunDto.queuePosition}. */
  readonly position: number;
  /** Which band of work this is; lower goes first. */
  readonly kindTier: number;
  readonly priority?: string | null;
  /** Where `priority` ranks within its tier; lower goes first. */
  readonly priorityRank: number;
  /**
   * Runs that must finish before this one may be claimed, because this one depends on them.
   *
   * Non-empty is the difference between *queued behind other work* and *stuck*, which is the whole
   * reason any of this is on the wire.
   */
  readonly topologyBlockers: readonly CiOrderingBlockerDto[];
  /** Which rule put the run here, in qits-ci's own vocabulary. */
  readonly selection: string;
}

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
 * The step executing right now. No image and no status, because the relay it comes from holds
 * neither. A renderer must not invent them.
 *
 * `startedAt` is the one timestamp the relay does know, and it is optional: absent from a daemon
 * older than the field, and from every run recorded before it existed. Where it is missing the
 * client falls back to when it first *saw* this step, which is a measurement of its own watching
 * rather than of the step — so where the server does say, the server wins.
 */
export interface CiLiveStepDto {
  readonly stepIndex: number;
  readonly output: string;
  readonly startedAt?: string | null;
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
  /**
   * The release request this run's pipeline gates, null for every run that gates none.
   *
   * A run triggered by a `ReleaseRequestChanged` builds the request's backing branch, whose
   * `commitSha` is a fold nobody pushed and is rewritten by the next re-fold. So this is the handle
   * that says *which piece of work* the run belongs to, where the sha only says which fold.
   */
  readonly releaseRequestId: string | null;
  /**
   * The run this one was fired to re-do, null on everything a trigger produced.
   *
   * Present means "somebody asked this question again". Its `triggerEventId` is then a synthetic
   * local token rather than a foreign event id, so nothing should be matched against an event log
   * by it — read this field instead, and link back to the run it names.
   */
  readonly retryOfRunId: string | null;
  readonly configPath: string | null;
  /**
   * How long each planned step is expected to take, in millis and in pipeline order — the p95 of the
   * same step's historical runtimes in the same pipeline.
   *
   * One entry per **planned** step, so the list describes the shape the run is expected to take
   * rather than the steps it has finished; it is carried by the listings as well as by the single
   * read, which is what lets the tree and the rail draw a bar without a per-run request. Every entry
   * is positive.
   *
   * Optional and nullable, and both say the same thing: qits-ci has no history to predict from, or
   * this build is talking to a server that does not answer it. A reader that has no expectations
   * draws exactly what it drew before the field existed — a prediction is an extra, never a
   * precondition.
   */
  readonly expectedStepDurationsMillis?: readonly number[] | null;
  /**
   * Which phase of a release this run is, null for every run that serves none.
   *
   * The column existed long before the mapper copied it, so a client holding a release request's
   * runs could not tell phase one from phase two. Optional and nullable: an older qits-ci answers
   * nothing here and every reader must render as it did before the field existed.
   */
  readonly phase?: CiRunPhase | null;
  /**
   * This run's 0-based index in qits-ci's suggested claim order. Null unless it is queued.
   *
   * It is what lets a rail tell *queued behind other work* from *stuck* — a wait with a position in
   * front of it is a queue doing its job, and a wait with none is a question.
   */
  readonly queuePosition?: number | null;
  /**
   * When this run is expected to start, **relative to the instant this response was computed** —
   * never an absolute clock time.
   *
   * Relative on purpose. An absolute instant would be compared against the reader's own clock, which
   * is not the server's, and a skew of a minute would show a run starting in the past. A relative
   * span is correct the moment it is read, and stale in a way that only ever understates the wait.
   *
   * Null when there is nothing to predict from; {@link predictionUnavailable} says which case it is.
   */
  readonly expectedStartInMillis?: number | null;
  /** When it is expected to finish, on the same relative-to-the-response footing. */
  readonly expectedFinishInMillis?: number | null;
  /**
   * Why there is no ETA, when there is none — so a reader is told rather than left with a blank.
   *
   * `RUN_HAS_NO_PREDICTION` (this pipeline has never been measured),
   * `RUN_AHEAD_HAS_NO_PREDICTION` (a queued run in front of it has not) and
   * `RUNNING_RUN_HAS_NO_PREDICTION` (a run already executing has not) are the three qits-ci answers
   * today, and they lead to different next actions — which is the reason the field is a token and
   * not a boolean.
   *
   * An **open string**, exactly like `cancellationReason`: a word this build has not been taught is
   * a word qits-ci added, and it is printed verbatim rather than flattened to "unknown".
   */
  readonly predictionUnavailable?: string | null;
  /** Why the run sits where it does in the queue. Null unless qits-ci has an ordering to explain. */
  readonly ordering?: CiRunOrderingDto | null;
  /**
   * The steps that have finished. Null on the per-repository listing, which carries none.
   *
   * `GET /ci/api/runs/active` **does** carry it — with every `output` null, since a listing is not a
   * log pane — so the rail can draw a run's real progress through its planned steps without a
   * per-run read. The shape is the same {@link CiStepDto} either way; only `output` differs.
   */
  readonly steps: readonly CiStepDto[] | null;
  /**
   * The step executing right now, non-null only while `status` is `RUNNING`.
   *
   * Carried by `GET /ci/api/runs/active` as well as by the single read, with `output` null on the
   * listing for the same reason `steps` has none there.
   */
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
