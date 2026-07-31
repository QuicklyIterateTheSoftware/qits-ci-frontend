/**
 * The wire shapes this client reads, hand-written and copied field-for-field from the Java records
 * on the other side (`CiRunDto`, `CiStepDto`, `CiLiveStepDto` in qits-ci; `ProjectDto`,
 * `RepositoryDto` in qits-projects).
 *
 * Hand-written rather than generated, deliberately. The platform generates OpenAPI *documents*, not
 * clients, and every controller here nests its request/response records inside the request type, so
 * a generator names them positionally — qits-projects' committed document already calls the
 * list-projects response `Response19` and one entry `Entry4`. A tree written against `Entry4` is
 * worse than one written against the twenty lines below, and the total surface is six endpoints.
 *
 * The response envelopes are genuinely inconsistent between the two services — `{runs: […]}` for
 * ci's list, a bare run for its single read, `{entries: [{project: …}]}` for projects — and the
 * interfaces say so rather than pretending otherwise. Straightening them out is the servers'
 * business, not this client's.
 *
 * `Instant` arrives as an ISO-8601 string; every timestamp below is typed as one and parsed only
 * where it is formatted.
 */

/** A run's outcome. `RUNNING` is the only non-terminal one, which is what the poll keys off. */
export type CiRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CONFIG_ERROR';

/** A step's outcome. `PENDING` and `RUNNING` are legacy on this enum and never written. */
export type CiStepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

/** What caused a run: a push, or an event that matched a committed trigger. */
export type CiTriggerType = 'POST_RECEIVE' | 'EVENT';

/** What a repository is for, as qits-projects classifies it. */
export type RepositoryArchetype =
  'PROJECT' | 'SERVICE' | 'LIBRARY' | 'INTEGRATION' | 'APPLICATION' | 'SERVICE_TEMPLATE' | 'FORK';

/** Trigger types in the order they are drawn; a group with no runs is not drawn at all. */
export const CI_TRIGGER_TYPES: readonly CiTriggerType[] = ['POST_RECEIVE', 'EVENT'];

/** A run is over when it is anything but `RUNNING` — the whole rule behind Decision 5's poll. */
export function isTerminal(status: CiRunStatus): boolean {
  return status !== 'RUNNING';
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

/** A CI run. `steps` is null in listings; `live` is non-null only while `status` is `RUNNING`. */
export interface CiRunDto {
  readonly id: string;
  readonly repoId: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly status: CiRunStatus;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly daemonVersion: string | null;
  readonly triggerType: CiTriggerType;
  readonly triggerEventId: string | null;
  readonly triggerEventName: string | null;
  readonly configPath: string | null;
  readonly steps: readonly CiStepDto[] | null;
  readonly live: CiLiveStepDto | null;
}

/** The repository ids qits-ci has runs for. Ids it *observed*, not repositories it owns. */
export interface CiRepositoriesResponse {
  readonly repositoryIds: readonly string[];
}

/** ci's list envelope. */
export interface CiRunsResponse {
  readonly runs: readonly CiRunDto[];
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
 * A repository. There is no name field — the tree derives a label from `url` and keeps `id` as the
 * identity, because `id` is the git-host directory name and therefore the join key `CiRun.repoId`
 * carries.
 */
export interface RepositoryDto {
  readonly id: string;
  readonly url: string;
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
