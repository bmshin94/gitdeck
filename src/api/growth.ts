import type { GrowthWorkspaceSummary } from "../types/growth";

/**
 * Phase 1 workspace summary. GS-022 replaces this placeholder with the
 * account-scoped Growth API request without changing overview callers.
 */
export async function fetchGrowthWorkspaceSummary(
  repository: string,
  signal?: AbortSignal,
): Promise<GrowthWorkspaceSummary> {
  if (signal?.aborted) throw new DOMException("The request was aborted", "AbortError");

  return {
    repository,
    interventionsByStatus: {
      proposed: 0,
      accepted: 0,
      dismissed: 0,
      done: 0,
    },
    contentItemsByStatus: {
      idea: 0,
      draft: 0,
      ready: 0,
      scheduled: 0,
      published: 0,
      skipped: 0,
    },
    nextSevenDays: [],
  };
}
