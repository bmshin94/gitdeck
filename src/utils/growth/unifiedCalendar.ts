import type {
  GrowthContentItem,
  GrowthProfile,
  GrowthUnifiedCalendar,
  GrowthUnifiedCalendarRepository,
} from "../../types/growth";
import { createDefaultGrowthProfile } from "./profileDefaults";

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" })
    || left.localeCompare(right, "en");
}

function compareContentItems(left: GrowthContentItem, right: GrowthContentItem): number {
  const leftTime = Date.parse(left.scheduledFor!);
  const rightTime = Date.parse(right.scheduledFor!);
  return leftTime - rightTime
    || left.scheduledFor!.localeCompare(right.scheduledFor!)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

function repositoryModel(
  repository: string,
  profile: GrowthProfile,
  contentItems: GrowthContentItem[],
): GrowthUnifiedCalendarRepository {
  return {
    repository,
    color: profile.color,
    timezone: profile.timezone,
    postingWindows: profile.postingWindows.map((window) => ({ ...window })),
    pillarLabels: profile.pillars.map(({ id, label }) => ({ id, label })),
    contentItems: contentItems.sort(compareContentItems),
  };
}

/** Builds a stable account-scoped calendar model without collapsing repository-local calendars. */
export function buildGrowthUnifiedCalendar(
  accountId: string,
  contentItems: readonly GrowthContentItem[],
  persistedProfiles: readonly GrowthProfile[],
): GrowthUnifiedCalendar {
  const profiles = new Map(
    persistedProfiles
      .filter((profile) => profile.accountId === accountId)
      .map((profile) => [profile.repository, profile]),
  );
  const itemsByRepository = new Map<string, GrowthContentItem[]>();

  for (const item of contentItems) {
    if (
      item.accountId !== accountId
      || item.status === "skipped"
      || item.scheduledFor === null
      || Number.isNaN(Date.parse(item.scheduledFor))
    ) continue;
    const repositoryItems = itemsByRepository.get(item.repository);
    if (repositoryItems) repositoryItems.push(item);
    else itemsByRepository.set(item.repository, [item]);
  }

  const repositories = new Set([...profiles.keys(), ...itemsByRepository.keys()]);
  return {
    repositories: [...repositories]
      .sort(compareText)
      .map((repository) => repositoryModel(
        repository,
        profiles.get(repository) ?? createDefaultGrowthProfile(accountId, repository),
        itemsByRepository.get(repository) ?? [],
      )),
  };
}
