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

const { registerGrowthRoutes } = await import("../../src/server/routes/growth");
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
