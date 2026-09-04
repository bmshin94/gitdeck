import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createGoal, deleteGoal } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import { Avatar } from "../common/Avatar";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { RepositoryContentSources } from "../common/RepositoryContentSources";
import { RepositoryPicker } from "../common/RepositoryPicker";
import { GoalIcon } from "../common/Icons";
import { GOAL_METRIC_DEFINITIONS, type GoalMetric, type RepositoryGoal } from "../../types/goals";
import type { GhRepo } from "../../types/github";
import { calculateGoalProgress, groupGoalsByRepository } from "../../utils/goals";
import { formatNumber } from "../../utils/format";
import { growthRepositoryPath } from "../../utils/growthRoutes";
import { GoalsLoadingState } from "./GoalsLoadingState";

interface GoalsViewProps {
  goals: RepositoryGoal[];
  repos: GhRepo[];
  loading: boolean;
  onChange: () => Promise<void> | void;
  fixedRepository?: string;
  loadError?: string;
}

const metricLabels = new Map<GoalMetric, string>(GOAL_METRIC_DEFINITIONS.map((metric) => [metric.id, metric.label]));

function currentRepoValue(repo: GhRepo | undefined, metric: GoalMetric): number {
  if (metric === "stars") return repo?.stargazerCount ?? 0;
  if (metric === "forks") return repo?.forkCount ?? 0;
  return 0;
}

export function GoalsView({ goals, repos, loading, onChange, fixedRepository, loadError = "" }: GoalsViewProps) {
  const { t } = useI18n();
  const [repository, setRepository] = useState("");
  const [metric, setMetric] = useState<GoalMetric>("stars");
  const [targetValue, setTargetValue] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RepositoryGoal | null>(null);
  const activeRepository = fixedRepository ?? repository;
  const scopedRepos = useMemo(
    () => fixedRepository ? repos.filter((repo) => repo.nameWithOwner === fixedRepository) : repos,
    [fixedRepository, repos],
  );
  const scopedGoals = useMemo(
    () => fixedRepository ? goals.filter((goal) => goal.repository === fixedRepository) : goals,
    [fixedRepository, goals],
  );
  const reposByName = useMemo(() => new Map(scopedRepos.map((repo) => [repo.nameWithOwner, repo])), [scopedRepos]);
  const groupedGoals = useMemo(() => groupGoalsByRepository(scopedGoals), [scopedGoals]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await createGoal({
        repository: activeRepository,
        metric,
        targetValue: Number(targetValue),
        currentValue: currentRepoValue(reposByName.get(activeRepository), metric),
        deadline,
      });
      setTargetValue("");
      setDeadline("");
      await onChange();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteGoal(id);
      await onChange();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="goals-view">
      <section className="goal-create-card">
        <div className="goal-create-intro">
          <span className="goal-create-icon"><GoalIcon /></span>
          <div>
            <h2>{t("goals.createTitle")}</h2>
            <p>{t("goals.createDescription")}</p>
          </div>
        </div>
        <form className="goal-form" onSubmit={(event) => void submit(event)}>
          <label>
            {t("goals.repository")}
            {fixedRepository ? (
              <input type="text" value={fixedRepository} readOnly aria-readonly="true" />
            ) : (
              <RepositoryPicker repos={scopedRepos} value={repository} placeholder={t("goals.searchRepository")} onChange={setRepository} />
            )}
          </label>
          <label>
            {t("goals.metric")}
            <select value={metric} onChange={(event) => setMetric(event.target.value as GoalMetric)}>
              {GOAL_METRIC_DEFINITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            {t("goals.target")}
            <input type="number" min="1" step="1" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} required />
          </label>
          <label>
            {t("goals.deadline")}
            <input type="date" min={new Date().toISOString().slice(0, 10)} value={deadline} onChange={(event) => setDeadline(event.target.value)} required />
          </label>
          <button className="btn primary" type="submit" disabled={saving || !activeRepository || !scopedRepos.length}>{saving ? t("common.loading") : t("goals.add")}</button>
        </form>
      </section>

      {error || loadError ? <div className="error" role="alert">{error || loadError}</div> : null}
      {loading && !scopedGoals.length ? <GoalsLoadingState label={t("common.loadingEllipsis")} /> : null}
      {!scopedGoals.length && !loading && !loadError ? <div className="empty"><h3>{t("goals.emptyTitle")}</h3><p>{t("goals.emptyText")}</p></div> : null}
      <div className="goal-repository-list">
        {groupedGoals.map((group) => {
          const repo = reposByName.get(group.repository);
          const completedCount = group.goals.filter((goal) => calculateGoalProgress(goal).completed).length;
          return (
            <section className="goal-repository-card" key={group.repository}>
              <header className="goal-repository-hero">
                <div className="goal-repository-identity">
                  <Avatar login={repo?.owner.login ?? group.repository.split("/")[0]} avatarUrl={repo?.owner.avatarUrl} size={44} />
                  <div>
                    <span className="goal-repository-kicker"><i /> {t("goals.mission")}</span>
                    <h2>{group.repository}</h2>
                    <p>{repo?.description || t("repo.noDescription")}</p>
                  </div>
                </div>
                <div className="goal-repository-score">
                  <strong>{completedCount}<span>/{group.goals.length}</span></strong>
                  <small>{t("goals.completedMissions")}</small>
                </div>
              </header>

              <div className="goal-track-grid">
                {group.goals.map((goal) => {
                  const progress = calculateGoalProgress(goal);
                  return (
                    <article className={`goal-track${progress.completed ? " complete" : progress.overdue ? " overdue" : ""}`} key={goal.id}>
                      <header>
                        <span className="goal-metric">{metricLabels.get(goal.metric) ?? goal.metric}</span>
                        <button className="icon-btn" onClick={() => setDeleteTarget(goal)} aria-label={t("common.remove")} title={t("common.remove")}>×</button>
                      </header>
                      <div className="goal-track-main">
                        <div className="goal-progress-orbit" style={{ background: `conic-gradient(var(--goal-tone) ${progress.percentage}%, var(--panel-3) 0)` }}>
                          <div><strong>{progress.percentage}</strong><span>%</span></div>
                        </div>
                        <div className="goal-track-copy">
                          <div className="goal-values"><strong>{formatNumber(goal.currentValue)}</strong><span>/ {formatNumber(goal.targetValue)}</span></div>
                          <div className="goal-progress" role="progressbar" aria-valuenow={progress.percentage} aria-valuemin={0} aria-valuemax={100}>
                            <span style={{ width: `${progress.percentage}%` }} />
                          </div>
                          <div className="goal-meta">
                            <span>{progress.completed ? t("goals.completed") : t("goals.remaining", { count: formatNumber(progress.remaining) })}</span>
                            <span>{progress.overdue ? t("goals.overdue") : t("goals.daysLeft", { count: progress.daysRemaining })}</span>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="goal-growth-studio">
                <div className="goal-studio-heading">
                  <div><span>{t("goals.growthStudioEyebrow")}</span><h3>{t("goals.growthStudio")}</h3></div>
                  <div className="goal-studio-actions">
                    <p>{t("goals.growthStudioDescription")}</p>
                    <RepositoryContentSources repository={group.repository} repos={scopedRepos} />
                  </div>
                </div>
                <div className="goal-plan-grid">
                  <section className="goal-plan goal-interventions-link">
                    <header className="goal-plan-head">
                      <div><span>{t("growth.interventionsEyebrow")}</span><strong>{t("growth.missionsBacklogTitle")}</strong></div>
                      <Link className="btn primary" to={`${growthRepositoryPath(group.repository) ?? "/growth"}/interventions`}>
                        {t("growth.missionsOpenBacklog")}
                      </Link>
                    </header>
                    <p>{t("growth.missionsBacklogDescription")}</p>
                  </section>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        kind={t("tabs.goals")}
        title={t("goals.deleteTitle")}
        message={<p>{t("goals.deleteMessage", {
          metric: deleteTarget ? metricLabels.get(deleteTarget.metric) ?? deleteTarget.metric : "",
          repo: deleteTarget?.repository ?? "",
        })}</p>}
        confirmLabel={t("common.remove")}
        danger
        icon={<GoalIcon />}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const id = deleteTarget?.id;
          setDeleteTarget(null);
          if (id) void remove(id);
        }}
      />
    </div>
  );
}
