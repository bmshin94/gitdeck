import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import type { GrowthContentMedia, GrowthProfileInput } from "../../src/types/growth";

const { TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return { TMP_DIR: resolve(tmpdir(), `gitdeck-growth-store-${process.pid}-${Date.now()}`) };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: TMP_DIR }));

const store = await import("../../src/server/growth/store");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

const MEDIA: GrowthContentMedia[] = [
  { kind: "image", url: "https://example.com/card.png", alt: "Release card" },
];

function profileInput(overrides: Partial<GrowthProfileInput> = {}): GrowthProfileInput {
  return {
    language: "en",
    voice: "Practical and direct",
    audience: "Open-source maintainers",
    channels: {
      x: true,
      linkedin: true,
      mastodon: true,
      bluesky: false,
      discussion: false,
      blog: false,
    },
    cadence: {
      x: 3,
      linkedin: 1,
      mastodon: 3,
      bluesky: 0,
      discussion: 0,
      blog: 0,
    },
    pillars: [
      { id: "product", label: "Product", weight: 100, description: "Product outcomes" },
    ],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 10 }],
    color: "#2563EB",
    ...overrides,
  };
}

function createDraft(accountId = "account-a", repository = "owner/repo") {
  return store.createContentItem({
    accountId,
    repository,
    channel: "x",
    format: "x-thread",
    status: "draft",
    title: "Release thread",
  });
}

describe("Growth Studio store", () => {
  beforeEach(async () => {
    closeDatabase();
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    closeDatabase();
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it("creates the complete schema idempotently and returns non-persisted profile defaults", () => {
    store.ensureGrowthSchema();
    store.ensureGrowthSchema();

    const tables = getDatabase().prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual([
      "content_items",
      "content_performance",
      "content_plans",
      "growth_assets",
      "growth_interventions",
      "growth_profiles",
    ]);

    const profile = store.getGrowthProfile("account-a", "owner/repo");
    expect(profile).toMatchObject({
      accountId: "account-a",
      repository: "owner/repo",
      language: "en",
      voice: "",
      audience: "",
      timezone: "UTC",
      channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
      cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
      hashtags: [],
      avoid: "",
      postingWindows: [],
    });
    expect(profile.pillars).toHaveLength(5);
    expect(profile.pillars.every(({ weight }) => weight === 20)).toBe(true);
    expect(profile.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(store.getGrowthProfile("account-b", "owner/repo").color).toBe(profile.color);

    const count = getDatabase().prepare("SELECT COUNT(*) AS count FROM growth_profiles").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("upserts profiles with decoded JSON fields and account scoping", () => {
    const saved = store.upsertGrowthProfile("account-a", "owner/repo", profileInput());
    expect(saved.voice).toBe("Practical and direct");
    expect(saved.pillars).toEqual([
      { id: "product", label: "Product", weight: 100, description: "Product outcomes" },
    ]);
    expect(saved.postingWindows).toEqual([{ weekday: 1, hour: 10 }]);
    expect(saved.updatedAt).not.toBe("");

    const updated = store.upsertGrowthProfile(
      "account-a",
      "owner/repo",
      profileInput({ voice: "Technical", hashtags: ["#gitdeck"] }),
    );
    expect(updated.voice).toBe("Technical");
    expect(updated.hashtags).toEqual(["#gitdeck"]);
    expect(store.getGrowthProfile("account-b", "owner/repo").voice).toBe("");
  });

  it("creates, lists, and updates interventions without crossing accounts", () => {
    const intervention = store.createGrowthIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      goalId: "goal-1",
      category: "marketing",
      title: "Share the release",
      action: "Publish a release thread.",
      origin: "manual",
      dedupeKey: "owner/repo:goal-1:share-release",
    });
    store.createGrowthIntervention({
      accountId: "account-a",
      repository: "owner/other",
      category: "community",
      title: "Welcome contributors",
      action: "Thank first-time contributors.",
      origin: "rule",
      ruleKey: "new-contributors",
      dedupeKey: "owner/other:new-contributors",
      status: "accepted",
    });

    expect(store.listGrowthInterventions("account-a", { repository: "owner/repo" })).toEqual([intervention]);
    expect(store.listGrowthInterventions("account-a", { goalId: "goal-1" })).toHaveLength(1);
    expect(store.listGrowthInterventions("account-a", { goalId: null })).toHaveLength(1);
    expect(store.listGrowthInterventions("account-b")).toEqual([]);
    expect(store.updateGrowthInterventionStatus("account-b", intervention.id, "done")).toBeNull();

    const accepted = store.updateGrowthInterventionStatus("account-a", intervention.id, "accepted");
    expect(accepted?.status).toBe("accepted");
    expect(store.listGrowthInterventions("account-a", { status: "accepted" })).toHaveLength(2);
  });

  it("creates and archives account-scoped content plans", () => {
    const input = profileInput();
    const plan = store.createContentPlan({
      accountId: "account-a",
      repository: "owner/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
      cadence: input.cadence,
      pillars: input.pillars,
      status: "active",
    });
    expect(plan.status).toBe("active");
    expect(plan.cadence.x).toBe(3);
    expect(store.archiveContentPlan("account-b", plan.id)).toBeNull();
    expect(store.archiveContentPlan("account-a", plan.id)?.status).toBe("archived");
  });

  it("filters content items by account, repository, status, and scheduled date range", () => {
    store.createContentItem({
      accountId: "account-a",
      repository: "owner/repo",
      channel: "linkedin",
      format: "linkedin-post",
      status: "scheduled",
      scheduledFor: "2026-09-08T10:00:00Z",
      media: MEDIA,
      title: "Tuesday post",
    });
    const thursday = store.createContentItem({
      accountId: "account-a",
      repository: "owner/repo",
      channel: "mastodon",
      format: "mastodon-post",
      status: "scheduled",
      scheduledFor: "2026-09-10T10:00:00Z",
      media: MEDIA,
      title: "Thursday post",
    });
    createDraft("account-a", "owner/repo");
    store.createContentItem({
      accountId: "account-a",
      repository: "owner/other",
      channel: "x",
      format: "x-thread",
      status: "scheduled",
      scheduledFor: "2026-09-10T10:00:00Z",
      media: MEDIA,
    });
    store.createContentItem({
      accountId: "account-b",
      repository: "owner/repo",
      channel: "x",
      format: "x-thread",
      status: "scheduled",
      scheduledFor: "2026-09-10T10:00:00Z",
      media: MEDIA,
    });

    expect(store.listContentItems("account-a", { repository: "owner/repo" })).toHaveLength(3);
    expect(store.listContentItems("account-a", { repository: "owner/repo", status: "draft" })).toHaveLength(1);
    expect(store.listContentItems("account-b")).toHaveLength(1);
    expect(store.listContentItems("account-a", {
      repository: "owner/repo",
      scheduledFrom: "2026-09-09T00:00:00Z",
      scheduledTo: "2026-09-11T00:00:00Z",
    })).toEqual([thursday]);
  });

  it("enforces media and scheduling invariants across content status changes", () => {
    for (const status of ["ready", "scheduled", "published"] as const) {
      expect(() => store.createContentItem({
        accountId: "account-a",
        repository: "owner/repo",
        channel: "x",
        format: "x-thread",
        status,
        scheduledFor: status === "scheduled" ? "2026-09-08T10:00:00Z" : null,
      })).toThrow(store.MediaRequiredError);
    }

    const draft = createDraft();
    expect(() => store.updateContentItem("account-a", draft.id, { status: "ready" }))
      .toThrow(store.MediaRequiredError);
    expect(store.getContentItem("account-a", draft.id)?.status).toBe("draft");

    const ready = store.updateContentItem("account-a", draft.id, { media: MEDIA, status: "ready" });
    expect(ready?.status).toBe("ready");
    expect(() => store.rescheduleContentItem("account-a", draft.id, "not-a-date"))
      .toThrow(store.ScheduleRequiredError);

    const scheduled = store.rescheduleContentItem("account-a", draft.id, "2026-09-08T10:00:00Z");
    expect(scheduled).toMatchObject({ status: "scheduled", scheduledFor: "2026-09-08T10:00:00Z" });
    expect(store.rescheduleContentItem("account-a", draft.id, null)).toMatchObject({
      status: "ready",
      scheduledFor: null,
    });

    expect(() => store.markContentItemPublished("account-a", draft.id, "ftp://example.com/post"))
      .toThrow(store.InvalidPublishedUrlError);
    const published = store.markContentItemPublished("account-a", draft.id, " https://example.com/post ");
    expect(published?.status).toBe("published");
    expect(published?.publishedUrl).toBe("https://example.com/post");
    expect(published?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("updates and deletes content only within the owning account", () => {
    const item = createDraft();
    expect(store.updateContentItem("account-b", item.id, { title: "Wrong account" })).toBeNull();
    expect(store.deleteContentItem("account-b", item.id)).toBe(false);
    expect(store.updateContentItem("account-a", item.id, {
      title: "Updated title",
      body: "Updated body",
      evergreen: 1,
    })).toMatchObject({ title: "Updated title", body: "Updated body", evergreen: 1 });
    expect(store.deleteContentItem("account-a", item.id)).toBe(true);
    expect(store.getContentItem("account-a", item.id)).toBeNull();
  });
});
