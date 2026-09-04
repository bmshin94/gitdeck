import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { AppRouter } from "../../src/server/router";
import type { Account } from "../../src/server/providers/types";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    activeAccountId: "account-a" as string | null,
    tmpDir: resolve(tmpdir(), `gitdeck-growth-routes-${process.pid}-${Date.now()}`),
    generateSuggestions: vi.fn(),
    generateProposals: vi.fn(),
    aiConfigured: false,
    generateStructured: vi.fn(),
    collectSignals: vi.fn(),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));
vi.mock("../../src/server/accountStore", () => ({
  getActive: vi.fn(async (): Promise<Account | null> => state.activeAccountId ? ({
    id: state.activeAccountId,
    providerKind: "github",
    providerConfigId: "github.com",
    label: state.activeAccountId,
    login: state.activeAccountId,
    accessToken: "token",
    scope: "repo",
    obtainedAt: "2026-09-04T00:00:00.000Z",
    source: "token",
  }) : null),
}));
vi.mock("../../src/server/goals", () => ({
  generateGoalProposals: state.generateProposals,
  generateRepositoryInterventionSuggestions: state.generateSuggestions,
  refreshGoal: vi.fn(async (goal) => goal),
  SOCIAL_PROPOSALS_VERSION: 4,
}));
vi.mock("../../src/server/ai/settings", () => ({
  isAiConfigured: vi.fn(() => state.aiConfigured),
}));
vi.mock("../../src/server/ai/client", async (importActual) => ({
  ...await importActual<typeof import("../../src/server/ai/client")>(),
  generateStructured: state.generateStructured,
}));
vi.mock("../../src/server/growth/signals", () => ({
  collectRepositorySignals: state.collectSignals,
}));

const { registerGrowthRoutes } = await import("../../src/server/routes/growth");
const { AiNotConfiguredError, AiRequestError } = await import("../../src/server/ai/client");
const goalStore = await import("../../src/server/goalStore");
const growthStore = await import("../../src/server/growth/store");
const { closeDatabase } = await import("../../src/server/sqlite");

interface TestResponse {
  status: number;
  body: Record<string, any>;
}

function request(method: string, path: string, body?: unknown): IncomingMessage {
  const input = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(input) as IncomingMessage;
  req.method = method;
  req.url = path;
  req.headers = body === undefined ? {} : { "content-type": "application/json" };
  return req;
}

async function dispatch(method: string, path: string, body?: unknown): Promise<TestResponse> {
  let status = 0;
  let responseBody = "";
  const res = {
    writeHead(code: number) { status = code; },
    end(chunk?: Buffer | string) { responseBody = chunk?.toString() ?? ""; },
    setHeader() {},
  } as unknown as ServerResponse;
  const router = new AppRouter();
  registerGrowthRoutes(router);
  await router.dispatch(request(method, path, body), res, new URL(path, "http://localhost"));
  return { status, body: JSON.parse(responseBody) as Record<string, any> };
}

function profileInput() {
  return {
    language: "en",
    voice: "Practical",
    audience: "Maintainers",
    channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product", weight: 100, description: "Outcomes" }],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 10 }],
    color: "#2563EB",
  };
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.activeAccountId = "account-a";
  state.aiConfigured = false;
  state.collectSignals.mockReset();
  state.collectSignals.mockResolvedValue({
    generatedOn: "2026-09-04",
    repository: "acme/repo",
    repositoryMetadata: null,
    openIssues: [],
    openPullRequests: [],
    releases: [],
    readme: null,
    additionalSources: [],
    recentCommits: [],
    starHistory: [],
    goals: [],
  });
  state.generateStructured.mockReset();
  state.generateSuggestions.mockReset();
  state.generateSuggestions.mockResolvedValue([{
    category: "marketing",
    title: "Share the release",
    action: "Publish a grounded release story.",
  }]);
  state.generateProposals.mockReset();
  state.generateProposals.mockResolvedValue([
    {
      title: "Release thread",
      format: "x-thread",
      summary: "Maintainers and contributors",
      content: "One\n\n---\n\nTwo",
      threadPosts: ["One", "Two"],
      mediaSuggestions: [{ kind: "image", title: "Release", sourceUrl: "https://example.com/release.png", guidance: "Show the release." }],
    },
    {
      title: "Release on LinkedIn",
      format: "linkedin-post",
      summary: "Engineering leaders",
      content: "A grounded release update.",
      threadPosts: [],
      mediaSuggestions: [{ kind: "image", title: "Release", sourceUrl: "https://example.com/release.png", guidance: "Show the release." }],
    },
    {
      title: "Release on Mastodon",
      format: "mastodon-post",
      summary: "Open-source community",
      content: "A community release update.",
      threadPosts: [],
      mediaSuggestions: [{ kind: "image", title: "Release", sourceUrl: "https://example.com/release.png", guidance: "Show the release." }],
    },
  ]);
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth API routes", () => {
  it("requires an active account", async () => {
    state.activeAccountId = null;
    const response = await dispatch("GET", "/api/growth/workspaces");
    expect(response).toEqual({
      status: 401,
      body: { ok: false, needsAuth: true, error: "authentication required" },
    });
  });

  it("round-trips normalized profiles and rejects invalid planning constraints", async () => {
    const input = {
      ...profileInput(),
      voice: "  Practical and direct  ",
      hashtags: [" #OpenSource ", "#opensource", "#GitDeck"],
      color: "#2563eb",
    };
    const saved = await dispatch("PUT", "/api/growth/profiles/acme/rocket", input);
    expect(saved.status).toBe(200);
    expect(saved.body.profile).toMatchObject({
      repository: "acme/rocket",
      voice: "Practical and direct",
      hashtags: ["#OpenSource", "#GitDeck"],
      color: "#2563EB",
    });
    expect((await dispatch("GET", "/api/growth/profiles/acme/rocket")).body.profile)
      .toEqual(saved.body.profile);

    const invalidProfiles: Array<[unknown, string]> = [
      [{ ...profileInput(), timezone: "Mars/Olympus" }, "IANA timezone"],
      [{ ...profileInput(), cadence: { ...profileInput().cadence, x: 15 } }, "0 through 14"],
      [{ ...profileInput(), channels: { ...profileInput().channels, unknown: true } }, "supported channel"],
      [{ ...profileInput(), pillars: [{ id: "product", label: "Product", weight: 101, description: "" }] }, "0 through 100"],
    ];
    for (const [invalid, message] of invalidProfiles) {
      const response = await dispatch("PUT", "/api/growth/profiles/acme/rocket", invalid);
      expect(response.status).toBe(400);
      expect(response.body.error).toContain(message);
    }
  });

  it("discovers profile-only and goal-backed workspaces and returns real counters", async () => {
    expect((await dispatch("PUT", "/api/growth/profiles/acme/profile-only", profileInput())).status).toBe(200);
    goalStore.createGoal({
      accountId: "account-a",
      repository: "acme/goal-only",
      metric: "stars",
      targetValue: 100,
      deadline: "2099-12-31",
    });
    await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/profile-only",
      category: "marketing",
      title: "Share the roadmap",
      action: "Publish the next milestone.",
    });
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await dispatch("POST", "/api/growth/content", {
      repository: "acme/profile-only",
      channel: "linkedin",
      format: "linkedin-post",
      status: "scheduled",
      scheduledFor,
      title: "Roadmap",
      media: [{ kind: "image", url: "https://example.com/roadmap.png", alt: "Roadmap" }],
    });

    const workspaces = await dispatch("GET", "/api/growth/workspaces");
    expect(workspaces.status).toBe(200);
    expect(workspaces.body.workspaces.map((workspace: { repository: string }) => workspace.repository))
      .toEqual(["acme/goal-only", "acme/profile-only"]);

    const overview = await dispatch("GET", "/api/growth/workspace/acme/profile-only");
    expect(overview.body.workspace).toMatchObject({
      repository: "acme/profile-only",
      interventionsByStatus: { proposed: 1, accepted: 0, dismissed: 0, done: 0 },
      contentItemsByStatus: { idea: 0, draft: 0, ready: 0, scheduled: 1, published: 0, skipped: 0 },
    });
    expect(overview.body.workspace.nextSevenDays).toHaveLength(1);
  });

  it("rejects invalid bodies and unknown patch fields with 400", async () => {
    const intervention = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "community",
      title: "Welcome contributors",
      action: "Thank first-time contributors.",
    });
    const content = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      status: "draft",
    });
    const cases: Array<[string, string, unknown]> = [
      ["PUT", "/api/growth/profiles/acme/repo", {}],
      ["POST", "/api/growth/interventions", { repository: "bad", category: "other", title: "", action: "" }],
      ["PATCH", `/api/growth/interventions/${intervention.body.intervention.id}`, { origin: "ai" }],
      ["POST", "/api/growth/content", { repository: "acme/repo", channel: "email", format: "email" }],
      ["PATCH", `/api/growth/content/${content.body.contentItem.id}`, { repository: "other/repo" }],
      ["POST", `/api/growth/content/${content.body.contentItem.id}/published`, { url: 42 }],
    ];

    for (const [method, path, body] of cases) {
      const response = await dispatch(method, path, body);
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(response.body.ok).toBe(false);
    }
    expect((await dispatch("GET", "/api/growth/content?status=unknown")).status).toBe(400);
    expect((await dispatch("GET", "/api/growth/workspace/bad/repo%2Fextra")).status).toBe(400);
  });

  it("scopes lists, reads, mutations, and deletes to the active account", async () => {
    await dispatch("PUT", "/api/growth/profiles/acme/private", profileInput());
    const interventionResponse = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/private",
      category: "engineering",
      title: "Explain the architecture",
      action: "Draft an architecture note.",
    });
    const contentResponse = await dispatch("POST", "/api/growth/content", {
      repository: "acme/private",
      channel: "blog",
      format: "doc",
      status: "draft",
    });
    const interventionId = interventionResponse.body.intervention.id as string;
    const contentId = contentResponse.body.contentItem.id as string;

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/workspaces")).body.workspaces).toEqual([]);
    expect((await dispatch("GET", "/api/growth/interventions?repo=acme%2Fprivate")).body.interventions).toEqual([]);
    expect((await dispatch("GET", "/api/growth/content?repo=acme%2Fprivate")).body.contentItems).toEqual([]);
    expect((await dispatch("PATCH", `/api/growth/interventions/${interventionId}`, { status: "done" })).status).toBe(404);
    expect((await dispatch("PATCH", `/api/growth/content/${contentId}`, { title: "Changed" })).status).toBe(404);
    expect((await dispatch("DELETE", `/api/growth/content/${contentId}`)).status).toBe(404);
    expect((await dispatch("GET", "/api/growth/profiles/acme/private")).body.profile.voice).toBe("");

    expect(growthStore.getGrowthIntervention("account-a", interventionId)?.status).toBe("proposed");
    expect(growthStore.getContentItem("account-a", contentId)?.title).toBe("");
  });

  it("generates and lists account-scoped editorial plans with strict validation and overlap protection", async () => {
    const input = profileInput();
    await dispatch("PUT", "/api/growth/profiles/acme/repo", {
      ...input,
      channels: { ...input.channels, linkedin: false, mastodon: false },
      cadence: { ...input.cadence, x: 1, linkedin: 0, mastodon: 0 },
    });

    const generated = await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(generated.status).toBe(201);
    expect(generated.body).toMatchObject({
      ok: true,
      aiEnabled: false,
      usedFallback: true,
      plan: { accountId: "account-a", repository: "acme/repo", status: "active" },
    });
    expect(generated.body.contentItems).toHaveLength(1);
    expect(state.collectSignals).toHaveBeenCalledTimes(1);

    const listed = await dispatch("GET", "/api/growth/plans?repo=acme%2Frepo");
    expect(listed.status).toBe(200);
    expect(listed.body.plans.map((plan: { id: string }) => plan.id)).toEqual([generated.body.plan.id]);

    const invalidRequests: Array<[string, string, unknown?]> = [
      ["GET", "/api/growth/plans"],
      ["GET", "/api/growth/plans?repo=bad"],
      ["GET", "/api/growth/plans?repo=acme%2Frepo&unknown=1"],
      ["POST", "/api/growth/plans/generate", { repository: "bad", periodStart: "2026-09-07", periodEnd: "2026-09-13" }],
      ["POST", "/api/growth/plans/generate", { repository: "acme/repo", periodStart: "2026-09-08", periodEnd: "2026-09-13" }],
      ["POST", "/api/growth/plans/generate", { repository: "acme/repo", periodStart: "2026-09-07", periodEnd: "2026-09-13", extra: true }],
    ];
    for (const [method, path, body] of invalidRequests) {
      expect((await dispatch(method, path, body)).status, `${method} ${path}`).toBe(400);
    }

    const overlapping = await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-20",
    });
    expect(overlapping.status).toBe(400);
    expect(growthStore.listContentPlans("account-a", "acme/repo")).toHaveLength(1);
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toHaveLength(1);

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/plans?repo=acme%2Frepo")).body.plans).toEqual([]);
    expect((await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).status).toBe(201);
    expect(growthStore.listContentPlans("account-a", "acme/repo")).toHaveLength(1);
    expect(growthStore.listContentPlans("account-b", "acme/repo")).toHaveLength(1);
  });

  it("returns a typed AI request error without persisting a plan", async () => {
    state.aiConfigured = true;
    state.generateStructured.mockRejectedValueOnce(new AiRequestError("planner provider failed"));

    const response = await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/failure",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });

    expect(response).toEqual({
      status: 502,
      body: { ok: false, error: "planner provider failed" },
    });
    expect(growthStore.listContentPlans("account-a", "acme/failure")).toEqual([]);
    expect(growthStore.listContentItems("account-a", { repository: "acme/failure" })).toEqual([]);
  });

  it("generates repository or mission interventions with dedupe and preserves user status", async () => {
    const first = await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/repo",
    });
    expect(first.status).toBe(200);
    expect(first.body.interventions).toEqual([
      expect.objectContaining({ origin: "ai", status: "proposed", title: "Share the release" }),
    ]);
    const interventionId = first.body.interventions[0].id as string;
    await dispatch("PATCH", `/api/growth/interventions/${interventionId}`, { status: "accepted" });
    state.generateSuggestions.mockResolvedValueOnce([{
      category: "marketing",
      title: " SHARE the release! ",
      action: "Publish the updated release story.",
    }]);

    const repeated = await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/repo",
    });
    expect(repeated.body.interventions).toEqual([
      expect.objectContaining({ id: interventionId, status: "accepted", action: "Publish the updated release story." }),
    ]);
    expect((await dispatch("GET", "/api/growth/interventions?repo=acme%2Frepo")).body.interventions).toHaveLength(1);

    const goal = goalStore.createGoal({
      accountId: "account-a",
      repository: "acme/repo",
      metric: "stars",
      targetValue: 100,
      deadline: "2099-12-31",
    });
    expect((await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/repo",
      goalId: goal.id,
    })).status).toBe(200);
    expect(state.generateSuggestions).toHaveBeenLastCalledWith(
      "account-a",
      "acme/repo",
      expect.objectContaining({ id: goal.id }),
    );
    expect((await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/other",
      goalId: goal.id,
    })).status).toBe(400);
  });

  it("deduplicates repeated manual interventions without resetting their status", async () => {
    const first = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "community",
      title: "Welcome contributors",
      action: "Document the contribution path.",
    });
    const id = first.body.intervention.id as string;
    await dispatch("PATCH", `/api/growth/interventions/${id}`, { status: "accepted" });

    const repeated = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "community",
      title: " WELCOME contributors! ",
      action: "Document one clear contribution path.",
    });
    expect(repeated.body.intervention).toMatchObject({
      id,
      status: "accepted",
      action: "Document one clear contribution path.",
    });
    expect(growthStore.listGrowthInterventions("account-a", { repository: "acme/repo" })).toHaveLength(1);
  });

  it("drafts intervention content idempotently and refreshes only editable items", async () => {
    const interventionResponse = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "marketing",
      title: "Announce the release",
      action: "Draft a verified release campaign.",
    });
    const interventionId = interventionResponse.body.intervention.id as string;

    const first = await dispatch("POST", "/api/growth/content/draft", { interventionId });
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);
    expect(first.body.contentItems).toHaveLength(3);
    expect(first.body.contentItems[0]).toMatchObject({
      interventionId,
      goalIds: [],
      channel: "x",
      format: "x-thread",
      status: "draft",
      generationVersion: 4,
    });
    expect(first.body.contentItems[0].media).toEqual([
      expect.objectContaining({ url: "https://example.com/release.png", alt: "Release" }),
    ]);
    expect(state.generateProposals).toHaveBeenCalledWith(
      { accountId: "account-a", repository: "acme/repo" },
      expect.objectContaining({ title: "Announce the release", category: "marketing" }),
      [],
    );

    const cached = await dispatch("POST", "/api/growth/content/draft", { interventionId });
    expect(cached.body.cached).toBe(true);
    expect(cached.body.contentItems.map((item: { id: string }) => item.id))
      .toEqual(first.body.contentItems.map((item: { id: string }) => item.id));
    expect(state.generateProposals).toHaveBeenCalledTimes(1);

    state.generateProposals.mockResolvedValueOnce(state.generateProposals.mock.results[0].value.then(
      (proposals: Array<Record<string, unknown>>) => proposals.map((proposal) => ({ ...proposal, title: `${proposal.title} refreshed` })),
    ));
    const refreshed = await dispatch("POST", "/api/growth/content/draft", { interventionId, refresh: true });
    expect(refreshed.body.cached).toBe(false);
    expect(refreshed.body.contentItems.map((item: { id: string }) => item.id))
      .toEqual(first.body.contentItems.map((item: { id: string }) => item.id));
    expect(refreshed.body.contentItems[0].title).toBe("Release thread refreshed");
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toHaveLength(3);

    const protectedId = refreshed.body.contentItems[0].id as string;
    expect((await dispatch("PATCH", `/api/growth/content/${protectedId}`, { status: "ready" })).status).toBe(200);
    const refreshWithProtectedItem = await dispatch("POST", "/api/growth/content/draft", { interventionId, refresh: true });
    expect(refreshWithProtectedItem.body.contentItems[0].id).not.toBe(protectedId);
    expect(growthStore.getContentItem("account-a", protectedId)).toMatchObject({
      status: "ready",
      title: "Release thread refreshed",
    });
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toHaveLength(4);

    const latestCached = await dispatch("POST", "/api/growth/content/draft", { interventionId });
    expect(latestCached.body.contentItems).toHaveLength(3);
    expect(latestCached.body.contentItems.map((item: { id: string }) => item.id))
      .toEqual(refreshWithProtectedItem.body.contentItems.map((item: { id: string }) => item.id));
  });

  it("returns the existing AI-not-configured response without creating drafts", async () => {
    const intervention = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "marketing",
      title: "Draft a campaign",
      action: "Use verified repository signals.",
    });
    state.generateProposals.mockRejectedValueOnce(new AiNotConfiguredError());

    const response = await dispatch("POST", "/api/growth/content/draft", {
      interventionId: intervention.body.intervention.id,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ ok: false, aiEnabled: false });
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toEqual([]);
  });

  it("keeps intervention drafting account-scoped and validates its body", async () => {
    const intervention = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/private",
      category: "marketing",
      title: "Private campaign",
      action: "Draft it.",
    });
    const id = intervention.body.intervention.id as string;
    expect((await dispatch("POST", "/api/growth/content/draft", { interventionId: "" })).status).toBe(400);
    expect((await dispatch("POST", "/api/growth/content/draft", { interventionId: id, unknown: true })).status).toBe(400);
    state.activeAccountId = "account-b";
    expect((await dispatch("POST", "/api/growth/content/draft", { interventionId: id })).status).toBe(404);
    expect(state.generateProposals).not.toHaveBeenCalled();
  });

  it("supports allowlisted updates, scheduling, publishing, and deletion", async () => {
    const interventionResponse = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "product",
      title: "Announce the release",
      action: "Draft the announcement.",
    });
    const interventionId = interventionResponse.body.intervention.id as string;
    expect((await dispatch("PATCH", `/api/growth/interventions/${interventionId}`, { status: "accepted" })).body.intervention.status)
      .toBe("accepted");

    const contentResponse = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      interventionId,
      channel: "x",
      format: "x-thread",
      status: "draft",
      media: [{ kind: "image", url: "https://example.com/release.png", alt: "Release" }],
    });
    const contentId = contentResponse.body.contentItem.id as string;
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await dispatch("PATCH", `/api/growth/content/${contentId}`, {
      title: "Release thread",
      scheduledFor,
    });
    expect(scheduled.body.contentItem).toMatchObject({ status: "scheduled", scheduledFor, title: "Release thread" });

    const published = await dispatch("POST", `/api/growth/content/${contentId}/published`, {
      url: "https://social.example/acme/1",
    });
    expect(published.body.contentItem).toMatchObject({
      status: "published",
      publishedUrl: "https://social.example/acme/1",
    });
    expect((await dispatch("DELETE", `/api/growth/content/${contentId}`)).status).toBe(200);
  });
});
