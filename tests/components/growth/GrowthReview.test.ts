import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthReview } from "../../../src/components/growth/GrowthReview";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthWeeklyReview } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({ fetchGrowthReview: vi.fn() }));
vi.mock("../../../src/api/growth", () => ({ fetchGrowthReview: mocks.fetchGrowthReview }));

const ZERO_METRICS = {
  starsDelta: 0,
  forksDelta: 0,
  closedPrsDelta: 0,
  releaseDownloadsDelta: 0,
};

function review(overrides: Partial<GrowthWeeklyReview> = {}): GrowthWeeklyReview {
  const item = {
    id: "published-1",
    repository: "acme/rocket",
    title: "Release result",
    channel: "x" as const,
    pillar: "product",
    status: "published" as const,
    scheduledFor: "2026-09-09T10:00:00.000Z",
    publishedAt: "2026-09-09T10:30:00.000Z",
    publishedUrl: "https://social.example/result",
  };
  return {
    generatedAt: "2026-09-16T12:00:00.000Z",
    repository: null,
    reviewPeriod: {
      start: "2026-09-07T00:00:00.000Z",
      end: "2026-09-13T23:59:59.999Z",
    },
    upcomingPeriod: {
      start: "2026-09-14T00:00:00.000Z",
      end: "2026-09-20T23:59:59.999Z",
    },
    publishedItems: [{
      ...item,
      performance: [{
        window: "48h",
        measuredAt: "2026-09-12T10:30:00.000Z",
        metrics: { ...ZERO_METRICS, starsDelta: 4 },
      }],
    }],
    missedItems: [{
      ...item,
      id: "missed-1",
      repository: "acme/docs",
      title: "Missed docs story",
      status: "draft",
      publishedAt: null,
      publishedUrl: null,
    }],
    upcomingItems: [{
      ...item,
      id: "upcoming-1",
      title: "Upcoming launch",
      status: "ready",
      scheduledFor: "2026-09-18T10:00:00.000Z",
      publishedAt: null,
      publishedUrl: null,
    }],
    performance: {
      windows: [
        {
          window: "48h",
          measuredItems: 1,
          metrics: { ...ZERO_METRICS, starsDelta: 4 },
          channels: [{ key: "x", measuredItems: 1, metrics: { ...ZERO_METRICS, starsDelta: 4 } }],
          pillars: [{ key: "product", measuredItems: 1, metrics: { ...ZERO_METRICS, starsDelta: 4 } }],
        },
        { window: "7d", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
      ],
    },
    channelFindings: [{
      dimension: "channel",
      window: "48h",
      key: "x",
      measuredItems: 1,
      metrics: { ...ZERO_METRICS, starsDelta: 4 },
      direction: "positive",
    }],
    pillarFindings: [{
      dimension: "pillar",
      window: "48h",
      key: "product",
      measuredItems: 1,
      metrics: { ...ZERO_METRICS, starsDelta: 4 },
      direction: "positive",
    }],
    recommendations: [1, 2, 3].map((number) => ({
      id: `action-${number}`,
      kind: "build-baseline" as const,
      title: `Next action ${number}`,
      action: `Complete action ${number}.`,
      repository: number === 1 ? "acme/rocket" : null,
    })),
    narrative: "One measured result provides a useful baseline.",
    empty: false,
    aiEnabled: true,
    usedFallback: false,
    ...overrides,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderReview(props: { accountId?: string; repository?: string } = {}) {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [props.repository ? `/growth/r/${props.repository}/review` : "/growth/review"] },
        createElement(GrowthReview, {
          accountId: props.accountId ?? "account-a",
          enabled: true,
          repository: props.repository,
        }),
      ),
    ));
    await flush();
  });
}

describe("GrowthReview", () => {
  it("renders a loading state while the account-scoped review is pending", async () => {
    let resolveLoad: ((value: GrowthWeeklyReview) => void) | undefined;
    mocks.fetchGrowthReview.mockImplementation(() => new Promise<GrowthWeeklyReview>((resolve) => {
      resolveLoad = resolve;
    }));

    await renderReview();
    expect(container.textContent).toContain("Loading the latest weekly Growth Review");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      resolveLoad?.(review());
      await flush();
    });
    expect(container.textContent).toContain("Weekly Growth Review");
  });

  it("renders global measured results, misses, upcoming work, recommendations, and reachable links", async () => {
    mocks.fetchGrowthReview.mockResolvedValue(review());
    await renderReview();

    expect(mocks.fetchGrowthReview).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    expect(container.textContent).toContain("Weekly Growth Review");
    expect(container.textContent).toContain("+4");
    expect(container.textContent).toContain("Strongest channel signals");
    expect(container.textContent).toContain("Release result");
    expect(container.textContent).toContain("Missed docs story");
    expect(container.textContent).toContain("Upcoming launch");
    expect(container.querySelectorAll(".growth-review-recommendations li")).toHaveLength(3);
    expect([...container.querySelectorAll(".growth-review-repository-chip")].map((node) => node.textContent))
      .toContain("acme/docs");
    const links = [...container.querySelectorAll<HTMLAnchorElement>(".growth-review-item-links a")];
    expect(links.some(({ href }) => href.includes("/growth/r/acme/rocket/calendar"))).toBe(true);
    expect(links.find(({ href }) => href.startsWith("https://social.example/result"))?.target).toBe("_blank");
    expect(container.querySelectorAll('[tabindex="0"]').length).toBeGreaterThan(6);
  });

  it("renders repository empty and deterministic-fallback states without global chips", async () => {
    mocks.fetchGrowthReview.mockResolvedValue(review({
      repository: "acme/rocket",
      publishedItems: [],
      missedItems: [],
      upcomingItems: [],
      performance: {
        windows: [
          { window: "48h", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
          { window: "7d", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
        ],
      },
      channelFindings: [],
      pillarFindings: [],
      narrative: "No content was published during the reviewed week.",
      empty: true,
      aiEnabled: false,
      usedFallback: true,
    }));
    await renderReview({ repository: "acme/rocket" });

    expect(mocks.fetchGrowthReview).toHaveBeenCalledWith(
      { repository: "acme/rocket" },
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("No review activity yet");
    expect(container.textContent).toContain("AI is not configured");
    expect(container.textContent).toContain("No 48-hour or 7-day measurements");
    expect(container.querySelectorAll(".growth-review-repository-chip")).toHaveLength(0);
  });

  it("renders load errors", async () => {
    mocks.fetchGrowthReview.mockRejectedValue(new Error("review unavailable"));
    await renderReview();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("review unavailable");
  });

  it("aborts and ignores stale loads when the account or repository changes", async () => {
    let resolveFirst: ((value: GrowthWeeklyReview) => void) | undefined;
    mocks.fetchGrowthReview
      .mockImplementationOnce((_filters, signal: AbortSignal) => new Promise<GrowthWeeklyReview>((resolve) => {
        resolveFirst = resolve;
        expect(signal.aborted).toBe(false);
      }))
      .mockResolvedValueOnce(review({ repository: "acme/docs", narrative: "Current account review." }));

    await renderReview({ accountId: "account-a", repository: "acme/rocket" });
    const firstSignal = mocks.fetchGrowthReview.mock.calls[0][1] as AbortSignal;
    await act(async () => {
      root.render(createElement(
        I18nProvider,
        null,
        createElement(
          MemoryRouter,
          null,
          createElement(GrowthReview, {
            accountId: "account-b",
            enabled: true,
            repository: "acme/docs",
          }),
        ),
      ));
      await flush();
    });

    expect(firstSignal.aborted).toBe(true);
    expect(container.textContent).toContain("Current account review.");
    await act(async () => {
      resolveFirst?.(review({ narrative: "Stale account review." }));
      await flush();
    });
    expect(container.textContent).not.toContain("Stale account review.");
  });
});
