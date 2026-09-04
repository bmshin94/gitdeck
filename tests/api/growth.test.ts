import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchGrowthPerformanceSummary,
  fetchGrowthReview,
  generateGrowthContentPlan,
} from "../../src/api/growth";

const ZERO_SUMMARY = {
  windows: [
    {
      window: "48h" as const,
      measuredItems: 0,
      metrics: { starsDelta: 0, forksDelta: 0, closedPrsDelta: 0, releaseDownloadsDelta: 0 },
      channels: [],
      pillars: [],
    },
    {
      window: "7d" as const,
      measuredItems: 0,
      metrics: { starsDelta: 0, forksDelta: 0, closedPrsDelta: 0, releaseDownloadsDelta: 0 },
      channels: [],
      pillars: [],
    },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn(async () => ({ ok: true, summary: ZERO_SUMMARY })),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Growth performance summary client", () => {
  it("requests encoded repository and inclusive UTC publication filters", async () => {
    const controller = new AbortController();

    await expect(fetchGrowthPerformanceSummary({
      repository: "acme/rocket",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-07T23:59:59.999Z",
    }, controller.signal)).resolves.toEqual(ZERO_SUMMARY);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/growth/performance/summary?repo=acme%2Frocket&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-07T23%3A59%3A59.999Z",
      { cache: "no-store", signal: controller.signal },
    );
  });

  it("preserves the typed plan weight adjustment result", async () => {
    const generated = {
      ok: true as const,
      plan: { id: "plan-1" },
      contentItems: [],
      aiEnabled: false,
      usedFallback: true,
      weightsAdjusted: true,
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: vi.fn(async () => generated),
    } as unknown as Response);
    const controller = new AbortController();

    await expect(generateGrowthContentPlan({
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    }, controller.signal)).resolves.toEqual(generated);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/growth/plans/generate", {
      cache: "no-store",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repository: "acme/rocket",
        periodStart: "2026-09-07",
        periodEnd: "2026-09-13",
      }),
      signal: controller.signal,
    });
  });

  it("requests repository-scoped weekly reviews and validates the repository before fetching", async () => {
    const review = { repository: "acme/rocket", recommendations: [] };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({ ok: true, review })),
    } as unknown as Response);
    const controller = new AbortController();

    await expect(fetchGrowthReview({ repository: "acme/rocket" }, controller.signal))
      .resolves.toEqual(review);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/growth/review?repo=acme%2Frocket",
      { cache: "no-store", signal: controller.signal },
    );

    fetchMock.mockClear();
    await expect(fetchGrowthReview({ repository: "invalid" })).rejects.toThrow("invalid repository");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid client filters before issuing a request", async () => {
    const invalidFilters = [
      { repository: "invalid" },
      { from: "2026-09-01T00:00:00+00:00" },
      { to: "not-a-date" },
      { from: "2026-09-08T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
    ];

    for (const filters of invalidFilters) {
      await expect(fetchGrowthPerformanceSummary(filters)).rejects.toThrow(/invalid/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
