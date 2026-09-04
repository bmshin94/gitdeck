import { describe, expect, it } from "vitest";
import type { GrowthContentItem, GrowthProfile } from "../../../src/types/growth";
import { createDefaultGrowthProfile } from "../../../src/utils/growth/profileDefaults";
import { buildGrowthUnifiedCalendar } from "../../../src/utils/growth/unifiedCalendar";

function contentItem(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "item-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: null,
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release",
    title: "Release",
    summary: "Release summary",
    body: "Release body",
    threadPosts: [],
    media: [],
    sources: [],
    status: "idea",
    scheduledFor: "2026-10-14T08:00:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function profile(repository: string, overrides: Partial<GrowthProfile> = {}): GrowthProfile {
  return {
    ...createDefaultGrowthProfile("account-a", repository),
    ...overrides,
  };
}

describe("unified Growth calendar read model", () => {
  it("keeps profile-only and content-only repositories separate with stable metadata and ordering", () => {
    const romeProfile = profile("acme/rome", {
      color: "#BE123C",
      timezone: "Europe/Rome",
      postingWindows: [{ weekday: 5, hour: 16 }, { weekday: 1, hour: 9 }],
      pillars: [
        { id: "release", label: "Releases", weight: 60, description: "Ship" },
        { id: "community", label: "Community", weight: 40, description: "People" },
      ],
    });
    const sameInstantInRome = contentItem({
      id: "rome-item",
      repository: "acme/rome",
      scheduledFor: "2026-10-14T22:30:00.000Z",
    });
    const contentOnly = contentItem({
      id: "alpha-item",
      repository: "Acme/alpha",
      scheduledFor: "2026-10-14T22:30:00.000Z",
    });
    const profileOnly = profile("acme/zulu", { color: "#047857", timezone: "Asia/Tokyo" });

    const calendar = buildGrowthUnifiedCalendar(
      "account-a",
      [sameInstantInRome, contentOnly],
      [profileOnly, romeProfile],
    );

    expect(calendar.repositories.map(({ repository }) => repository)).toEqual([
      "Acme/alpha",
      "acme/rome",
      "acme/zulu",
    ]);
    expect(calendar.repositories[0]).toMatchObject({
      repository: "Acme/alpha",
      color: createDefaultGrowthProfile("account-a", "Acme/alpha").color,
      timezone: "UTC",
      postingWindows: [],
    });
    expect(calendar.repositories[1]).toMatchObject({
      color: "#BE123C",
      timezone: "Europe/Rome",
      postingWindows: [{ weekday: 5, hour: 16 }, { weekday: 1, hour: 9 }],
      pillarLabels: [
        { id: "release", label: "Releases" },
        { id: "community", label: "Community" },
      ],
    });
    expect(calendar.repositories[2].contentItems).toEqual([]);
    expect(calendar.repositories[0].contentItems[0].scheduledFor)
      .toBe(calendar.repositories[1].contentItems[0].scheduledFor);
  });

  it("retains every dated editorial status except skipped and sorts items independently of input order", () => {
    const statuses = ["idea", "draft", "ready", "scheduled", "published"] as const;
    const visible = statuses.map((status, index) => contentItem({
      id: `visible-${status}`,
      status,
      scheduledFor: `2026-10-14T${String(12 - index).padStart(2, "0")}:00:00.000Z`,
    }));
    const excluded = [
      contentItem({ id: "skipped", status: "skipped" }),
      contentItem({ id: "undated", scheduledFor: null }),
      contentItem({ id: "invalid-date", scheduledFor: "not-a-date" }),
      contentItem({ id: "foreign-item", accountId: "account-b", repository: "private/repo" }),
    ];
    const foreignProfile = profile("private/profile", { accountId: "account-b" });

    const first = buildGrowthUnifiedCalendar(
      "account-a",
      [...visible, ...excluded].reverse(),
      [foreignProfile],
    );
    const second = buildGrowthUnifiedCalendar(
      "account-a",
      [...visible, ...excluded],
      [foreignProfile],
    );

    expect(first).toEqual(second);
    expect(first.repositories).toHaveLength(1);
    expect(first.repositories[0].contentItems.map(({ status }) => status)).toEqual([
      "published",
      "scheduled",
      "ready",
      "draft",
      "idea",
    ]);
    expect(first.repositories.flatMap(({ contentItems }) => contentItems).map(({ id }) => id)).toEqual([
      "visible-published",
      "visible-scheduled",
      "visible-ready",
      "visible-draft",
      "visible-idea",
    ]);
  });
});
