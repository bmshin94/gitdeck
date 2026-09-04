import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { GhIssue, GhPullRequest, GhRepo, RepoCommit, SnapshotEntry } from "../../types/github";
import type { GoalContentSource, GoalMetric } from "../../types/goals";
import { calculateGoalProgress } from "../../utils/goals";
import { extractMediaUrls, extractWebPageSignal } from "../../utils/socialProposals";
import { getIssuesCached, getPullRequestsCached, getReposCached } from "../dashboardData";
import { getRepositoryContentSources, listGoals } from "../goalStore";
import { restApi } from "../githubClient";
import { getRepositorySnapshotHistory } from "../snapshots";

const README_EXCERPT_CHARS = 7000;

export interface GrowthReleaseSignal {
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
}

export interface GrowthReadmeSignal {
  excerpt: string;
  mediaUrls: string[];
}

export interface GrowthGoalSignal {
  id: string;
  metric: GoalMetric;
  current: number;
  target: number;
  deadline: string;
  percentage: number;
  completed: boolean;
  overdue: boolean;
}

export interface GrowthRepositorySignals {
  generatedOn: string;
  repository: string;
  repositoryMetadata: GhRepo | null;
  openIssues: GhIssue[];
  openPullRequests: GhPullRequest[];
  releases: GrowthReleaseSignal[];
  readme: GrowthReadmeSignal | null;
  additionalSources: unknown[];
  recentCommits: RepoCommit[];
  starHistory: SnapshotEntry[];
  goals: GrowthGoalSignal[];
}

export async function fetchReleaseSignals(repository: string): Promise<GrowthReleaseSignal[]> {
  try {
    const result = await restApi<GrowthReleaseSignal[]>(`/repos/${repository}/releases?per_page=3`);
    return result.ok && Array.isArray(result.data) ? result.data.slice(0, 3) : [];
  } catch {
    return [];
  }
}

export async function fetchReadmeSignal(repository: string): Promise<GrowthReadmeSignal | null> {
  try {
    const result = await restApi<{ content?: string; encoding?: string; download_url?: string | null }>(`/repos/${repository}/readme`);
    if (!result.ok || !result.data?.content) return null;
    const text = result.data.encoding === "base64"
      ? Buffer.from(result.data.content, "base64").toString("utf-8")
      : result.data.content;
    return {
      excerpt: text.replace(/\r/g, "").trim().slice(0, README_EXCERPT_CHARS),
      mediaUrls: extractMediaUrls(text, result.data.download_url),
    };
  } catch {
    return null;
  }
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:") && isPrivateAddress(normalized.slice(7));
}

async function assertPublicWebsite(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsupported source URL");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) throw new Error("private source URL");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("private source URL");
}

async function readBoundedText(response: Response, maxBytes = 600_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchWebsiteSignal(value: string): Promise<unknown> {
  try {
    let url = new URL(value);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await assertPublicWebsite(url);
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(7_000),
        headers: { Accept: "text/html,text/plain,image/*,video/*", "User-Agent": "GitDeck/1.0 source-reader" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new Error("too many source redirects");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`source returned ${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.startsWith("image/") || contentType.startsWith("video/")) {
        return { type: "website", url: value, title: null, excerpt: null, mediaUrls: [url.toString()] };
      }
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("unsupported source content");
      const page = extractWebPageSignal(await readBoundedText(response), url.toString());
      return { type: "website", url: value, title: page.title, excerpt: page.excerpt, mediaUrls: page.mediaUrls };
    }
  } catch (error) {
    return { type: "website", url: value, error: (error as Error).message };
  }
  return { type: "website", url: value, error: "source unavailable" };
}

export async function fetchAdditionalSourceSignals(sources: GoalContentSource[]): Promise<unknown[]> {
  return Promise.all(sources.map(async (source) => {
    if (source.type === "website") return fetchWebsiteSignal(source.value);
    const [readme, releases] = await Promise.all([
      fetchReadmeSignal(source.value),
      fetchReleaseSignals(source.value),
    ]);
    return {
      type: source.type,
      repository: source.value,
      readmeExcerpt: readme?.excerpt ?? null,
      mediaUrls: readme?.mediaUrls ?? [],
      releases: releases.map((release) => ({
        name: release.name || release.tag_name || null,
        url: release.html_url ?? null,
        publishedAt: release.published_at ?? null,
        notesExcerpt: release.body?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      })),
    };
  }));
}

async function fetchRecentCommits(repository: string): Promise<RepoCommit[]> {
  try {
    const result = await restApi<RepoCommit[]>(`/repos/${repository}/commits?per_page=20`);
    return result.ok && Array.isArray(result.data) ? result.data.slice(0, 20) : [];
  } catch {
    return [];
  }
}

/** Collects the account-scoped repository evidence shared by Growth Studio AI consumers. */
export async function collectRepositorySignals(
  accountId: string,
  repository: string,
  sources = getRepositoryContentSources(accountId, repository),
): Promise<GrowthRepositorySignals> {
  const repositoryGoals = listGoals(accountId).filter((goal) => goal.repository === repository);
  const [issuesResult, prsResult, reposResult, releases, readme, additionalSources, recentCommits, starHistory] = await Promise.all([
    getIssuesCached(false),
    getPullRequestsCached(false),
    getReposCached(false),
    fetchReleaseSignals(repository),
    fetchReadmeSignal(repository),
    fetchAdditionalSourceSignals(sources),
    fetchRecentCommits(repository),
    getRepositorySnapshotHistory(repository),
  ]);
  const openIssues = issuesResult.ok
    ? issuesResult.issues.filter((item) => item.repository.nameWithOwner === repository)
    : [];
  const openPullRequests = prsResult.ok
    ? prsResult.pullRequests.filter((item) => item.repository.nameWithOwner === repository)
    : [];
  const repositoryMetadata = reposResult.ok
    ? reposResult.repos.find((item) => item.nameWithOwner === repository) ?? null
    : null;
  const goals = repositoryGoals.map((goal) => {
    const progress = calculateGoalProgress(goal);
    return {
      id: goal.id,
      metric: goal.metric,
      current: goal.currentValue,
      target: goal.targetValue,
      deadline: goal.deadline,
      percentage: progress.percentage,
      completed: progress.completed,
      overdue: progress.overdue,
    };
  });

  return {
    generatedOn: new Date().toISOString().slice(0, 10),
    repository,
    repositoryMetadata,
    openIssues,
    openPullRequests,
    releases,
    readme,
    additionalSources,
    recentCommits,
    starHistory,
    goals,
  };
}
