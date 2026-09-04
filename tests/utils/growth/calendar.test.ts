import { describe, expect, it } from "vitest";
import type { GrowthContentItem } from "../../../src/types/growth";
import {
  buildGrowthCalendarMonth,
  calendarDateInTimezone,
  groupGrowthCalendarItems,
  growthCalendarUtcRange,
  normalizeCalendarDate,
  shiftCalendarMonth,
} from "../../../src/utils/growth/calendar";

function contentItem(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: "plan-1",
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release story",
    title: "Release thread",
    summary: "Read the release",
    body: "Release body",
    threadPosts: [],
    media: [],
    sources: [],
    status: "idea",
    scheduledFor: "2026-03-31T22:30:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("growth calendar utilities", () => {
  it("builds a Monday-first six-week grid around the selected month", () => {
    const grid = buildGrowthCalendarMonth("2026-08-19");

    expect(grid.monthStart).toBe("2026-08-01");
    expect(grid.rangeStart).toBe("2026-07-27");
    expect(grid.rangeEnd).toBe("2026-09-06");
    expect(grid.days).toHaveLength(42);
    expect(grid.days.filter((day) => day.inCurrentMonth)).toHaveLength(31);
    expect(grid.days[0]).toEqual({ date: "2026-07-27", dayOfMonth: 27, inCurrentMonth: false });
  });

  it("normalizes invalid dates and shifts months without overflowing shorter months", () => {
    expect(normalizeCalendarDate("2026-02-31", "2026-09-04")).toBe("2026-09-04");
    expect(normalizeCalendarDate("2026-02-14", "2026-09-04")).toBe("2026-02-14");
    expect(shiftCalendarMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftCalendarMonth("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("groups scheduled items by their local profile date and excludes skipped or unscheduled work", () => {
    const first = contentItem();
    const second = contentItem({ id: "content-2", scheduledFor: "2026-04-01T08:00:00.000Z" });
    const skipped = contentItem({ id: "skipped", status: "skipped" });
    const backlog = contentItem({ id: "backlog", scheduledFor: null });

    const grouped = groupGrowthCalendarItems([second, skipped, backlog, first], "Europe/Rome");

    expect(calendarDateInTimezone(first.scheduledFor!, "Europe/Rome")).toBe("2026-04-01");
    expect(calendarDateInTimezone(first.scheduledFor!, "America/Los_Angeles")).toBe("2026-03-31");
    expect(grouped.get("2026-04-01")?.map((item) => item.id)).toEqual(["content-1", "content-2"]);
    expect([...grouped.values()].flat().map((item) => item.id)).not.toContain("skipped");
  });

  it("converts the full local six-week grid to inclusive UTC API bounds across DST", () => {
    const grid = buildGrowthCalendarMonth("2026-10-15");

    expect(growthCalendarUtcRange(grid, "Europe/Rome")).toEqual({
      scheduledFrom: "2026-09-27T22:00:00.000Z",
      scheduledTo: "2026-11-08T22:59:59.999Z",
    });
  });
});
