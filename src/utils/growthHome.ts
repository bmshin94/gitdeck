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
  activeRepositories?: string[],
): GrowthHomeSummary {
  const repositoriesByName = new Map(repositories.map((repo) => [repo.nameWithOwner, repo]));
  const goalGroups = groupGoalsByRepository(goals);
  const goalsByRepository = new Map(goalGroups.map((group) => [group.repository, group.goals]));
  const representedRepositories = new Set(activeRepositories ?? goalGroups.map((group) => group.repository));
  for (const group of goalGroups) representedRepositories.add(group.repository);
  const workspaces = [...representedRepositories].map((repository) => {
    const repositoryGoals = goalsByRepository.get(repository) ?? [];
    return {
      repository,
      repo: repositoriesByName.get(repository) ?? null,
      goals: repositoryGoals,
      completedGoals: repositoryGoals.filter((goal) => calculateGoalProgress(goal).completed).length,
    };
  });

  return {
    workspaces,
    starterRepositories: repositories.filter((repo) => !representedRepositories.has(repo.nameWithOwner)),
    totalGoals: goals.length,
    completedGoals: workspaces.reduce((total, workspace) => total + workspace.completedGoals, 0),
  };
}
