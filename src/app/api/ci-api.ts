import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CiQueueResponse,
  CiRepositoriesResponse,
  CiRepositorySummariesResponse,
  CiRepositorySummaryDto,
  CiRunDto,
  CiRunnerCreated,
  CiRunnerDto,
  CiRunnersResponse,
  CiRunsResponse,
  CreateRunnerRequest,
  PatchRunnerRequest,
} from './dto';

/**
 * Everything this app reads from qits-ci, and the two things it writes.
 *
 * `HttpClient` on the fetch backend rather than bare `fetch()`, for two reasons that both cash out
 * elsewhere: `HttpTestingController` is the only request-mocking story Angular ships and the specs
 * for these pages are mostly "given this response, render that", and `withFetch()` routes through
 * `window.fetch`, which is what the platform's OTel browser instrumentation hooks. The observable
 * is unwrapped with `firstValueFrom` immediately — these are one-shot reads, and a promise is what
 * the pages' `async` methods want.
 *
 * Angular 21.2 also ships `httpResource()`, which would be a very good fit for lazy tree expansion.
 * It is still marked `@experimental 19.2` in the pinned `@angular/common`, so it is not used here;
 * this service is the seam that makes adopting it a change inside the page components rather than a
 * rewrite.
 */
@Injectable({ providedIn: 'root' })
export class CiApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * The distinct repository ids qits-ci holds runs for, ascending. This is what makes CI activity
   * that no project claims visible at all — without it the tree could only ever draw what
   * qits-projects already knows about.
   */
  async repositoryIds(): Promise<readonly string[]> {
    const response = await firstValueFrom(
      this.http.get<CiRepositoriesResponse>(`${this.base}/ci/api/repositories`),
    );
    return response.repositoryIds;
  }

  /**
   * One headline pair per repository qits-ci has runs for: the latest run, and the latest on the
   * repository's main branch. Ascending by repository id.
   *
   * Read once when the tree loads, and again only when the active list shows the platform's work in
   * flight has changed. It is the tree's one aggregate read, and the alternative — a run listing per
   * repository just to learn each row's newest status — is the eager fan-out Decision 3 exists to
   * avoid, paid on every repository rather than only the expanded ones.
   */
  async repositorySummaries(): Promise<readonly CiRepositorySummaryDto[]> {
    const response = await firstValueFrom(
      this.http.get<CiRepositorySummariesResponse>(`${this.base}/ci/api/repositories/summary`),
    );
    return response.repositories;
  }

  /**
   * Everything the platform has in flight — QUEUED or RUNNING, every repository, newest first.
   *
   * Deliberately tiny and deliberately unfiltered: this is the one read on either page whose job is
   * *discovery* rather than following something already on screen, so it cannot be narrowed to what
   * the user has expanded without answering a different question.
   */
  async activeRuns(): Promise<readonly CiRunDto[]> {
    const response = await firstValueFrom(
      this.http.get<CiRunsResponse>(`${this.base}/ci/api/runs/active`),
    );
    return response.runs;
  }

  /**
   * The newest finished runs — every status that is not `QUEUED` or `RUNNING` — across every
   * repository, newest first.
   *
   * The complement of {@link activeRuns}, and the other half of the same question: that one is what
   * the platform is doing, this one is what it just did. The two are complements over one table
   * server-side, so a run that leaves the first arrives in the second, which is what lets the rail
   * watch a run finish without ever reading it individually.
   *
   * `limit` is required here where the per-repository listing's is optional, and the asymmetry is
   * the server's: this listing is scoped to no repository, so "all of them" would be every run on
   * the instance. Absent it would default to five anyway; sending it keeps the number the caller's.
   */
  async finishedRuns(limit: number): Promise<readonly CiRunDto[]> {
    const response = await firstValueFrom(
      this.http.get<CiRunsResponse>(`${this.base}/ci/api/runs/finished`, {
        params: new HttpParams().set('limit', limit),
      }),
    );
    return response.runs;
  }

  /**
   * One repository's runs, newest first, without step output. `limit` is optional and absent means
   * unbounded — which is what the *show all* affordance sends once the first page came back full.
   */
  async runs(repositoryId: string, limit?: number): Promise<readonly CiRunDto[]> {
    let params = new HttpParams().set('repositoryId', repositoryId);
    if (limit !== undefined) {
      params = params.set('limit', limit);
    }
    const response = await firstValueFrom(
      this.http.get<CiRunsResponse>(`${this.base}/ci/api/runs`, { params }),
    );
    return response.runs;
  }

  /** One run with its steps and their output — bare, not enveloped, unlike the listing. */
  run(runId: string): Promise<CiRunDto> {
    return firstValueFrom(
      this.http.get<CiRunDto>(`${this.base}/ci/api/runs/${encodeURIComponent(runId)}`),
    );
  }

  /**
   * Ask a running run to stop. 202, not 200: the container has only been *asked*, and the run is
   * not finished when this returns — the caller re-reads the run for the outcome. A run that is not
   * running answers 409, which is a race the page tolerates rather than an error it reports.
   */
  async cancel(runId: string, reason?: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.base}/ci/api/runs/${encodeURIComponent(runId)}/cancel`,
        reason === undefined ? null : { reason },
      ),
    );
  }

  /**
   * Run a finished run's pipeline again, at the same commit, and answer the **new** run's id.
   *
   * 202, like the cancel, and for the same kind of reason: what comes back is a run that has been
   * accepted and queued, not one that has produced anything. The id is the point of the response —
   * the caller navigates to it and follows it like any other run. A run that has not finished
   * answers 409, which is the same race the cancel button tolerates seen from the other side.
   */
  async retry(runId: string): Promise<string> {
    const response = await firstValueFrom(
      this.http.post<RetryRunResponse>(
        `${this.base}/ci/api/runs/${encodeURIComponent(runId)}/retry`,
        null,
      ),
    );
    return response.runId;
  }

  /**
   * The run queue as qits-ci itself sees it: how much capacity it has, running and queued runs in
   * claim order, and — where the deployment answers it — the runners sharing that capacity.
   *
   * Bare, not enveloped, like the single-run read: qits-ci's own record carries these fields at its
   * top level rather than wrapping a `runs` list, and this interface is copied field-for-field.
   */
  queue(): Promise<CiQueueResponse> {
    return firstValueFrom(this.http.get<CiQueueResponse>(`${this.base}/ci/api/runs/queue`));
  }

  /** Every runner qits-ci knows about, whether or not it has ever connected. Enveloped. */
  async runners(): Promise<readonly CiRunnerDto[]> {
    const response = await firstValueFrom(
      this.http.get<CiRunnersResponse>(`${this.base}/ci/api/runners`),
    );
    return response.runners;
  }

  /**
   * Register a new runner and answer its one-time install script alongside it.
   *
   * The 201 body is the only place the script is ever carried — see {@link CiRunnerCreated} — so
   * the caller must show it now or not at all.
   */
  createRunner(body: CreateRunnerRequest): Promise<CiRunnerCreated> {
    return firstValueFrom(
      this.http.post<CiRunnerCreated>(`${this.base}/ci/api/runners`, body),
    );
  }

  /** Change a runner's slots, description or step memory limit. Send only the fields that changed. */
  patchRunner(id: string, body: PatchRunnerRequest): Promise<CiRunnerDto> {
    return firstValueFrom(
      this.http.patch<CiRunnerDto>(`${this.base}/ci/api/runners/${encodeURIComponent(id)}`, body),
    );
  }

  /**
   * Mint a fresh registration token for a runner that already exists, answering a new install
   * script the same way creation does. The old token stops working the moment this one is issued.
   */
  replaceRegistrationToken(id: string): Promise<CiRunnerCreated> {
    return firstValueFrom(
      this.http.post<CiRunnerCreated>(
        `${this.base}/ci/api/runners/${encodeURIComponent(id)}/registration-token`,
        null,
      ),
    );
  }

  /**
   * Remove a runner. 204 on success; a runner still holding a run answers 409 with a message this
   * client renders rather than a generic failure, since it is a fact the caller can act on — wait,
   * or move the run first.
   */
  async deleteRunner(id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.base}/ci/api/runners/${encodeURIComponent(id)}`),
    );
  }

  /**
   * Force a quarantined runner out of quarantine immediately, ahead of its next scheduled check.
   * Admin-only. The server answers either the updated runner or a bare 204 — Angular's `HttpClient`
   * parses an empty JSON body as `null`, so both shapes come back through the same return type with
   * no branching needed here.
   */
  greenlightRunner(id: string): Promise<CiRunnerDto | null> {
    return firstValueFrom(
      this.http.post<CiRunnerDto | null>(
        `${this.base}/ci/api/runners/${encodeURIComponent(id)}/greenlight`,
        null,
      ),
    );
  }

  /**
   * Queue a health check on demand, rather than waiting for the hourly cadence a quarantined
   * runner already gets. Answers the queued run's id; a check already queued or running for this
   * runner answers 409, whose message the caller renders rather than a generic failure.
   */
  async runRunnerHealthcheck(id: string): Promise<string> {
    const response = await firstValueFrom(
      this.http.post<RunnerHealthcheckResponse>(
        `${this.base}/ci/api/runners/${encodeURIComponent(id)}/healthcheck`,
        null,
      ),
    );
    return response.runId;
  }
}

/** What a retry answers: the id of the run it queued. */
interface RetryRunResponse {
  readonly runId: string;
}

/** What an on-demand health check answers: the id of the run it queued. */
interface RunnerHealthcheckResponse {
  readonly runId: string;
}
