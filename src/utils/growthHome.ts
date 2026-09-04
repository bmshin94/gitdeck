import type { GhRepo } from "../types/github";
import type { RepositoryGoal } from "../types/goals";
import { calculateGoalProgress, groupGoalsByRepository } from "./goals";

export interface GrowthHomeWorkspace {
  repository: string;
  repo: GhRepo | null;
  goals: RepositoryGoal[];
  completedGoals: number;
}

export interface GrowthHomeSummary {
  workspaces: GrowthHomeWorkspace[];
  starterRepositories: GhRepo[];
  totalGoals: number;
  completedGoals: number;
}

/** Builds account-wide home cards while preserving goals whose repository metadata is unavailable. */
export function buildGrowthHomeSummary(
  goals: RepositoryGoal[],
  repositories: GhRepo[],
): GrowthHomeSummary {
  const repositoriesByName = new Map(repositories.map((repo) => [repo.nameWithOwner, repo]));
  const workspaces = groupGoalsByRepository(goals).map((group) => ({
    repository: group.repository,
    repo: repositoriesByName.get(group.repository) ?? null,
    goals: group.goals,
    completedGoals: group.goals.filter((goal) => calculateGoalProgress(goal).completed).length,
  }));
  const representedRepositories = new Set(workspaces.map((workspace) => workspace.repository));

  return {
    workspaces,
    starterRepositories: repositories.filter((repo) => !representedRepositories.has(repo.nameWithOwner)),
    totalGoals: goals.length,
    completedGoals: workspaces.reduce((total, workspace) => total + workspace.completedGoals, 0),
  };
}
