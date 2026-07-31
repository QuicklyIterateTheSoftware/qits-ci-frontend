import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CiRepositoriesResponse,
  CiRepositorySummariesResponse,
  CiRepositorySummaryDto,
  CiRunDto,
  CiRunsResponse,
} from './dto';

/**
 * Everything this app reads from qits-ci, and the one thing it writes.
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
  async cancel(runId: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.base}/ci/api/runs/${encodeURIComponent(runId)}/cancel`, null),
    );
  }
}
