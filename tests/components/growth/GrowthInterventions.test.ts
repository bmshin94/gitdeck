import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthInterventions } from "../../../src/components/growth/GrowthInterventions";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthIntervention, GrowthInterventionStatus } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  fetchAiSettings: vi.fn(),
  fetchGrowthInterventions: vi.fn(),
  fetchGrowthContentItems: vi.fn(),
  createGrowthIntervention: vi.fn(),
  draftGrowthContentFromIntervention: vi.fn(),
  generateGrowthInterventions: vi.fn(),
  patchGrowthIntervention: vi.fn(),
  patchGrowthContentItem: vi.fn(),
  markGrowthContentPublished: vi.fn(),
  useGoals: vi.fn(),
}));

vi.mock("../../../src/api/github", () => ({ fetchAiSettings: mocks.fetchAiSettings }));
vi.mock("../../../src/api/growth", () => ({
  fetchGrowthInterventions: mocks.fetchGrowthInterventions,
  fetchGrowthContentItems: mocks.fetchGrowthContentItems,
  createGrowthIntervention: mocks.createGrowthIntervention,
  draftGrowthContentFromIntervention: mocks.draftGrowthContentFromIntervention,
  generateGrowthInterventions: mocks.generateGrowthInterventions,
  patchGrowthIntervention: mocks.patchGrowthIntervention,
  patchGrowthContentItem: mocks.patchGrowthContentItem,
  markGrowthContentPublished: mocks.markGrowthContentPublished,
}));
vi.mock("../../../src/hooks/useGoals", () => ({ useGoals: mocks.useGoals }));

function intervention(id: string, status: GrowthInterventionStatus): GrowthIntervention {
  return {
    id,
    accountId: "account-a",
    repository: "acme/rocket",
    goalId: status === "proposed" ? "goal-1" : null,
    category: "marketing",
    title: `${status} action`,
    action: `Complete the ${status} action.`,
    origin: "ai",
    ruleKey: null,
    dedupeKey: id,
    status,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
  const interventions = [
    intervention("proposed", "proposed"),
    intervention("accepted", "accepted"),
    intervention("done", "done"),
    intervention("dismissed", "dismissed"),
  ];
  mocks.fetchAiSettings.mockResolvedValue({ settings: { enabled: false } });
  mocks.fetchGrowthInterventions.mockResolvedValue(interventions);
  const contentItem = {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: null,
    interventionId: "proposed",
    goalIds: ["goal-1"],
    channel: "x",
    format: "x-thread",
    pillar: "",
    angle: "",
    title: "Launch thread",
    summary: "A launch campaign",
    body: "Launch body",
    threadPosts: ["First launch post", "Second launch post"],
    media: [{ kind: "image", url: "https://example.com/launch.png", alt: "Launch" }],
    sources: [],
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    publishedUrl: null,
    generatedAt: "2026-09-04T00:00:00.000Z",
    generationVersion: 4,
    evergreen: 0,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
  mocks.fetchGrowthContentItems.mockResolvedValue([contentItem]);
  mocks.draftGrowthContentFromIntervention.mockResolvedValue({ ok: true, contentItems: [contentItem], cached: true });
  mocks.useGoals.mockReturnValue({
    goals: [{ id: "goal-1", metric: "stars", currentValue: 50, targetValue: 100 }],
  });
  mocks.patchGrowthIntervention.mockImplementation(async (id: string, updates: { status: GrowthInterventionStatus }) => ({
    ...interventions.find((item) => item.id === id)!,
    status: updates.status,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function renderPanel() {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ["/growth/r/acme/rocket/interventions"] },
        createElement(GrowthInterventions, {
          accountId: "account-a",
          enabled: true,
          repository: "acme/rocket",
        }),
      ),
    ));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GrowthInterventions", () => {
  it("renders status groups, linked goals and content while keeping dismissed actions collapsed", async () => {
    await renderPanel();

    expect(container.textContent).toContain("Growth interventions");
    expect(container.textContent).toContain("Mission: Stars 50 / 100");
    expect(container.textContent).toContain("Launch thread");
    expect(container.textContent).toContain("AI is not configured");
    expect(container.textContent).not.toContain("dismissed action");

    const dismissedToggle = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Dismissed"));
    await act(async () => dismissedToggle?.click());
    expect(container.textContent).toContain("dismissed action");
  });

  it("drafts content from an intervention and opens the returned item drawer", async () => {
    await renderPanel();
    const draft = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Draft from intervention");

    await act(async () => {
      draft?.click();
      await Promise.resolve();
    });

    expect(mocks.draftGrowthContentFromIntervention).toHaveBeenCalledWith("proposed");
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Launch thread");
  });

  it("shows drafting failures and the AI preferences handoff inline", async () => {
    mocks.draftGrowthContentFromIntervention.mockRejectedValueOnce(new Error("AI is not configured"));
    await renderPanel();
    const draft = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Draft from intervention");

    await act(async () => {
      draft?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("AI is not configured");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/preferences#preferences-ai"]')?.target).toBe("_blank");
  });

  it("updates an intervention status through the account-scoped API", async () => {
    await renderPanel();
    const accept = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Accept");

    await act(async () => {
      accept?.click();
      await Promise.resolve();
    });

    expect(mocks.patchGrowthIntervention).toHaveBeenCalledWith("proposed", { status: "accepted" });
  });
});
