import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthCalendar } from "../../../src/components/growth/calendar/GrowthCalendar";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthContentItem, GrowthProfile } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  fetchGrowthProfile: vi.fn(),
  fetchGrowthContentItems: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  fetchGrowthProfile: mocks.fetchGrowthProfile,
  fetchGrowthContentItems: mocks.fetchGrowthContentItems,
}));
vi.mock("../../../src/components/growth/ContentItemDrawer", () => ({
  ContentItemDrawer: ({ item, onUpdate }: {
    item: GrowthContentItem;
    onUpdate: (item: GrowthContentItem) => void;
  }) => createElement("div", { role: "dialog" },
    createElement("span", null, item.title),
    createElement("button", {
      type: "button",
      onClick: () => onUpdate({ ...item, title: "Updated calendar title" }),
    }, "Update item"),
  ),
}));

function profile(): GrowthProfile {
  return {
    accountId: "account-a",
    repository: "acme/rocket",
    language: "en",
    voice: "Practical",
    audience: "Maintainers",
    channels: { x: true, linkedin: true, mastodon: false, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 0, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product news", weight: 100, description: "Releases" }],
    hashtags: [],
    avoid: "",
    timezone: "Europe/Rome",
    postingWindows: [],
    color: "#2563EB",
    updatedAt: "2026-09-04T08:00:00.000Z",
  };
}

function contentItem(id = "content-1", title = "October release"): GrowthContentItem {
  return {
    id,
    accountId: "account-a",
    repository: "acme/rocket",
    planId: "plan-1",
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release angle",
    title,
    summary: "Read more",
    body: "Release body",
    threadPosts: [],
    media: [],
    sources: [],
    status: "idea",
    scheduledFor: "2026-09-30T22:30:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location" }, `${location.pathname}${location.search}`);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.fetchGrowthProfile.mockResolvedValue(profile());
  mocks.fetchGrowthContentItems.mockResolvedValue([contentItem()]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderCalendar(accountId = "account-a", entry = "/growth/r/acme/rocket/calendar?view=month&date=2026-10-15") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [entry] },
        createElement(LocationProbe),
        createElement(GrowthCalendar, {
          accountId,
          enabled: true,
          repository: "acme/rocket",
        }),
      ),
    ));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GrowthCalendar", () => {
  it("loads the visible month in the profile timezone and opens a focusable item drawer", async () => {
    await renderCalendar();

    expect(mocks.fetchGrowthProfile).toHaveBeenCalledWith("acme/rocket", expect.any(AbortSignal));
    expect(mocks.fetchGrowthContentItems).toHaveBeenCalledWith({
      repository: "acme/rocket",
      scheduledFrom: "2026-09-27T22:00:00.000Z",
      scheduledTo: "2026-11-08T22:59:59.999Z",
    }, expect.any(AbortSignal));
    expect(container.querySelectorAll(".growth-calendar-day")).toHaveLength(42);

    const itemButton = [...container.querySelectorAll<HTMLButtonElement>(".growth-calendar-item")]
      .find((button) => button.textContent?.includes("October release"));
    expect(itemButton?.tagName).toBe("BUTTON");
    expect(itemButton?.textContent).toContain("00:30");
    expect(itemButton?.textContent).toContain("Product news");
    expect(itemButton?.closest(".growth-calendar-day")?.getAttribute("aria-label")).toContain("October 1, 2026");

    await act(async () => itemButton?.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("October release");

    const update = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Update item");
    await act(async () => update?.click());
    expect(container.textContent).toContain("Updated calendar title");
    expect(container.textContent).not.toContain("October release");
  });

  it("normalizes invalid month URLs and provides month navigation controls", async () => {
    await renderCalendar("account-a", "/growth/r/acme/rocket/calendar?date=2026-02-31");

    const location = container.querySelector('[data-testid="location"]')?.textContent ?? "";
    expect(location).toContain("?view=month&date=");
    expect(location).not.toContain("2026-02-31");

    const previous = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Previous"));
    await act(async () => previous?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toContain("view=month&date=");
  });

  it("renders localized empty and error states", async () => {
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([]);
    await renderCalendar();
    expect(container.textContent).toContain("No content in these six weeks");

    mocks.fetchGrowthProfile.mockRejectedValueOnce(new Error("profile unavailable"));
    await renderCalendar("account-b");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("profile unavailable");
  });

  it("aborts stale calendar data when the active account changes", async () => {
    let resolveOld: ((items: GrowthContentItem[]) => void) | undefined;
    const staleRequest = new Promise<GrowthContentItem[]>((resolve) => {
      resolveOld = resolve;
    });
    mocks.fetchGrowthContentItems
      .mockImplementationOnce(() => staleRequest)
      .mockResolvedValueOnce([contentItem("content-new", "New account item")]);

    await renderCalendar();
    const staleSignal = mocks.fetchGrowthContentItems.mock.calls[0][1] as AbortSignal;

    await renderCalendar("account-b");
    expect(staleSignal.aborted).toBe(true);
    expect(container.textContent).toContain("New account item");

    await act(async () => {
      resolveOld?.([contentItem("content-old", "Stale account item")]);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Stale account item");
  });
});
