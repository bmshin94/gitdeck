import { describe, expect, it } from "vitest";
import type { GhRepo } from "../../src/types/github";
import type { RepositoryGoal } from "../../src/types/goals";
import { buildGrowthHomeSummary } from "../../src/utils/growthHome";

function repo(nameWithOwner: string): GhRepo {
  const [owner, name] = nameWithOwner.split("/");
  return {
    nameWithOwner,
    name,
    owner: { login: owner },
    description: `${name} description`,
    stargazerCount: 10,
    forkCount: 2,
    primaryLanguage: null,
    updatedAt: "2026-09-04T00:00:00.000Z",
    pushedAt: "2026-09-04T00:00:00.000Z",
    visibility: "PUBLIC",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    url: `https://github.com/${nameWithOwner}`,
  };
}

function goal(id: string, repository: string, currentValue: number, targetValue = 10): RepositoryGoal {
  return {
    id,
    accountId: "account-a",
    repository,
    metric: "stars",
    targetValue,
    currentValue,
    deadline: "2026-12-31",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    suggestions: [],
    suggestionsGeneratedAt: null,
    aiEnabled: true,
  };
}

describe("buildGrowthHomeSummary", () => {
  it("groups mission counts and excludes represented repositories from the starter list", () => {
    const active = repo("acme/active");
    const starter = repo("acme/starter");
    const summary = buildGrowthHomeSummary([
      goal("complete", active.nameWithOwner, 10),
      goal("open", active.nameWithOwner, 4),
    ], [active, starter]);

    expect(summary).toMatchObject({ totalGoals: 2, completedGoals: 1 });
    expect(summary.workspaces).toHaveLength(1);
    expect(summary.workspaces[0]).toMatchObject({
      repository: "acme/active",
      repo: active,
      completedGoals: 1,
    });
    expect(summary.starterRepositories.map((entry) => entry.nameWithOwner)).toEqual(["acme/starter"]);
  });

  it("keeps a fallback workspace when repository metadata is unavailable", () => {
    const summary = buildGrowthHomeSummary(
      [goal("legacy", "legacy/missing", 1)],
      [repo("acme/starter")],
    );

    expect(summary.workspaces[0]).toMatchObject({
      repository: "legacy/missing",
      repo: null,
      completedGoals: 0,
    });
    expect(summary.starterRepositories).toHaveLength(1);
  });

  it("includes profile-only repositories supplied by the workspace API", () => {
    const profileOnly = repo("acme/profile-only");
    const starter = repo("acme/starter");
    const summary = buildGrowthHomeSummary([], [profileOnly, starter], [profileOnly.nameWithOwner]);

    expect(summary.workspaces).toEqual([{
      repository: profileOnly.nameWithOwner,
      repo: profileOnly,
      goals: [],
      completedGoals: 0,
    }]);
    expect(summary.starterRepositories).toEqual([starter]);
  });
});
