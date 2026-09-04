import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchAiSettings } from "../../api/github";
import {
  createGrowthIntervention,
  fetchGrowthContentItems,
  fetchGrowthInterventions,
  generateGrowthInterventions,
  patchGrowthIntervention,
} from "../../api/growth";
import { useGoals } from "../../hooks/useGoals";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import {
  GROWTH_INTERVENTION_STATUSES,
  type GrowthContentItem,
  type GrowthIntervention,
  type GrowthInterventionCategory,
  type GrowthInterventionOrigin,
  type GrowthInterventionStatus,
} from "../../types/growth";
import { GOAL_METRIC_DEFINITIONS, type GoalMetric } from "../../types/goals";
import { formatNumber } from "../../utils/format";

interface GrowthInterventionsProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
}

const CATEGORIES: GrowthInterventionCategory[] = ["product", "community", "engineering", "marketing"];
const ORIGINS: GrowthInterventionOrigin[] = ["ai", "rule", "manual"];
const metricLabels = new Map<GoalMetric, string>(GOAL_METRIC_DEFINITIONS.map((metric) => [metric.id, metric.label]));
const statusKeys: Record<GrowthInterventionStatus, TranslationKey> = {
  proposed: "growth.status.proposed",
  accepted: "growth.status.accepted",
  dismissed: "growth.status.dismissed",
  done: "growth.status.done",
};
const categoryKeys: Record<GrowthInterventionCategory, TranslationKey> = {
  product: "growth.interventionsCategory.product",
  community: "growth.interventionsCategory.community",
  engineering: "growth.interventionsCategory.engineering",
  marketing: "growth.interventionsCategory.marketing",
};
const originKeys: Record<GrowthInterventionOrigin, TranslationKey> = {
  ai: "growth.interventionsOrigin.ai",
  rule: "growth.interventionsOrigin.rule",
  manual: "growth.interventionsOrigin.manual",
};

export function GrowthInterventions({ accountId, enabled, repository }: GrowthInterventionsProps) {
  const { t } = useI18n();
  const { goals } = useGoals({ accountId, enabled, repository });
  const [interventions, setInterventions] = useState<GrowthIntervention[]>([]);
  const [contentItems, setContentItems] = useState<GrowthContentItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | GrowthInterventionCategory>("all");
  const [originFilter, setOriginFilter] = useState<"all" | GrowthInterventionOrigin>("all");
  const [generationGoalId, setGenerationGoalId] = useState("");
  const [manualCategory, setManualCategory] = useState<GrowthInterventionCategory>("product");
  const [manualTitle, setManualTitle] = useState("");
  const [manualAction, setManualAction] = useState("");
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !repository) return;
    setLoading(true);
    setError("");
    try {
      const [nextInterventions, nextContentItems] = await Promise.all([
        fetchGrowthInterventions({ repository }, signal),
        fetchGrowthContentItems({ repository }, signal),
      ]);
      if (signal?.aborted) return;
      setInterventions(nextInterventions);
      setContentItems(nextContentItems);
    } catch (cause) {
      if (!signal?.aborted && (cause as Error).name !== "AbortError") setError((cause as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [enabled, repository]);

  useEffect(() => {
    setAiEnabled(null);
    if (!enabled) return;
    let current = true;
    void fetchAiSettings()
      .then(({ settings }) => {
        if (current) setAiEnabled(settings.enabled);
      })
      .catch(() => {
        // Generation still has a deterministic fallback when settings cannot be read.
      });
    return () => {
      current = false;
    };
  }, [accountId, enabled]);

  useEffect(() => {
    setInterventions([]);
    setContentItems([]);
    setNotice("");
    setDismissedOpen(false);
    if (!enabled || !repository) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [accountId, enabled, load, repository]);

  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);
  const contentByIntervention = useMemo(() => {
    const grouped = new Map<string, GrowthContentItem[]>();
    for (const item of contentItems) {
      if (!item.interventionId) continue;
      grouped.set(item.interventionId, [...(grouped.get(item.interventionId) ?? []), item]);
    }
    return grouped;
  }, [contentItems]);
  const filtered = useMemo(() => interventions.filter((intervention) => (
    (categoryFilter === "all" || intervention.category === categoryFilter)
    && (originFilter === "all" || intervention.origin === originFilter)
  )), [categoryFilter, interventions, originFilter]);

  async function changeStatus(intervention: GrowthIntervention, status: GrowthInterventionStatus) {
    setBusy(intervention.id);
    setError("");
    setNotice("");
    try {
      const updated = await patchGrowthIntervention(intervention.id, { status });
      setInterventions((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    setBusy("generate");
    setError("");
    setNotice("");
    try {
      const result = await generateGrowthInterventions(repository, generationGoalId || undefined);
      await load();
      setAiEnabled(result.aiEnabled);
      setNotice(result.aiEnabled
        ? t("growth.interventionsGenerated", { count: result.interventions.length })
        : t("growth.interventionsGeneratedFallback", { count: result.interventions.length }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function createManual(event: FormEvent) {
    event.preventDefault();
    setBusy("manual");
    setError("");
    setNotice("");
    try {
      await createGrowthIntervention({
        repository,
        category: manualCategory,
        title: manualTitle,
        action: manualAction,
      });
      setManualTitle("");
      setManualAction("");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  function renderIntervention(intervention: GrowthIntervention) {
    const linkedGoal = intervention.goalId ? goalsById.get(intervention.goalId) : null;
    const linkedContent = contentByIntervention.get(intervention.id) ?? [];
    return (
      <article className="growth-intervention-card" key={intervention.id}>
        <div className="growth-intervention-card-head">
          <div className="growth-intervention-badges">
            <span className={`growth-intervention-category category-${intervention.category}`}>{t(categoryKeys[intervention.category])}</span>
            <span className="growth-intervention-origin">{t(originKeys[intervention.origin])}</span>
          </div>
          {linkedGoal ? (
            <span className="growth-intervention-goal">
              {t("growth.interventionsLinkedMission", {
                mission: `${metricLabels.get(linkedGoal.metric) ?? linkedGoal.metric} ${formatNumber(linkedGoal.currentValue)} / ${formatNumber(linkedGoal.targetValue)}`,
              })}
            </span>
          ) : null}
        </div>
        <h3>{intervention.title}</h3>
        <p>{intervention.action}</p>
        {linkedContent.length ? (
          <div className="growth-intervention-content">
            <strong>{t("growth.interventionsContentItems", { count: linkedContent.length })}</strong>
            <ul>
              {linkedContent.map((item) => (
                <li key={item.id}>
                  <span>{item.title || item.format}</span>
                  <small>{t(`growth.status.${item.status}` as TranslationKey)}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="growth-intervention-actions">
          {intervention.status === "proposed" || intervention.status === "dismissed" ? (
            <button className="btn primary" type="button" disabled={busy === intervention.id} onClick={() => void changeStatus(intervention, "accepted")}>
              {t("growth.interventionsAccept")}
            </button>
          ) : null}
          {intervention.status === "accepted" ? (
            <button className="btn primary" type="button" disabled={busy === intervention.id} onClick={() => void changeStatus(intervention, "done")}>
              {t("growth.interventionsMarkDone")}
            </button>
          ) : null}
          {intervention.status !== "dismissed" && intervention.status !== "done" ? (
            <button className="btn ghost" type="button" disabled={busy === intervention.id} onClick={() => void changeStatus(intervention, "dismissed")}>
              {t("growth.interventionsDismiss")}
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <section className="growth-interventions">
      <header className="growth-interventions-hero">
        <div>
          <span>{t("growth.interventionsEyebrow")}</span>
          <h1>{t("growth.interventionsTitle")}</h1>
          <p>{t("growth.interventionsDescription", { repository })}</p>
        </div>
        <div className="growth-interventions-generate">
          <label>
            {t("growth.interventionsGenerationScope")}
            <select value={generationGoalId} onChange={(event) => setGenerationGoalId(event.target.value)}>
              <option value="">{t("growth.interventionsRepositoryWide")}</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {metricLabels.get(goal.metric) ?? goal.metric}: {formatNumber(goal.currentValue)} / {formatNumber(goal.targetValue)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="button" disabled={busy !== ""} onClick={() => void generate()}>
            {busy === "generate" ? t("growth.interventionsGenerating") : t("growth.interventionsGenerate")}
          </button>
          {aiEnabled === false ? (
            <p className="growth-interventions-ai-note">
              {t("growth.interventionsNoAi")} <a href="/preferences#preferences-ai" target="_blank" rel="noopener">{t("growth.interventionsOpenPreferences")}</a>
            </p>
          ) : null}
        </div>
      </header>

      {error ? <div className="growth-interventions-error" role="alert">{t("growth.interventionsError", { message: error })}</div> : null}
      {notice ? <div className="growth-interventions-notice" role="status">{notice}</div> : null}

      <section className="growth-interventions-tools">
        <div className="growth-interventions-filters">
          <label>
            {t("growth.interventionsFilterCategory")}
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
              <option value="all">{t("growth.interventionsAllCategories")}</option>
              {CATEGORIES.map((category) => <option key={category} value={category}>{t(categoryKeys[category])}</option>)}
            </select>
          </label>
          <label>
            {t("growth.interventionsFilterOrigin")}
            <select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as typeof originFilter)}>
              <option value="all">{t("growth.interventionsAllOrigins")}</option>
              {ORIGINS.map((origin) => <option key={origin} value={origin}>{t(originKeys[origin])}</option>)}
            </select>
          </label>
        </div>
        <form className="growth-interventions-manual" onSubmit={(event) => void createManual(event)}>
          <div>
            <span>{t("growth.interventionsManualEyebrow")}</span>
            <h2>{t("growth.interventionsManualTitle")}</h2>
          </div>
          <label>
            {t("growth.interventionsCategoryLabel")}
            <select value={manualCategory} onChange={(event) => setManualCategory(event.target.value as GrowthInterventionCategory)}>
              {CATEGORIES.map((category) => <option key={category} value={category}>{t(categoryKeys[category])}</option>)}
            </select>
          </label>
          <label>
            {t("growth.interventionsTitleLabel")}
            <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} required maxLength={160} />
          </label>
          <label className="growth-interventions-action-field">
            {t("growth.interventionsActionLabel")}
            <textarea value={manualAction} onChange={(event) => setManualAction(event.target.value)} required maxLength={1200} rows={3} />
          </label>
          <button className="btn" type="submit" disabled={busy !== "" || !manualTitle.trim() || !manualAction.trim()}>
            {busy === "manual" ? t("growth.interventionsCreating") : t("growth.interventionsCreate")}
          </button>
        </form>
      </section>

      {loading && !interventions.length ? <p className="growth-interventions-loading">{t("growth.interventionsLoading")}</p> : null}
      {!loading && !filtered.length ? (
        <div className="growth-interventions-empty"><h2>{t("growth.interventionsEmptyTitle")}</h2><p>{t("growth.interventionsEmptyDescription")}</p></div>
      ) : null}

      <div className="growth-intervention-groups" aria-busy={loading}>
        {GROWTH_INTERVENTION_STATUSES.filter((status) => status !== "dismissed").map((status) => {
          const entries = filtered.filter((intervention) => intervention.status === status);
          return (
            <section className={`growth-intervention-group status-${status}`} key={status}>
              <header><h2>{t(statusKeys[status])}</h2><span>{entries.length}</span></header>
              {entries.length ? <div className="growth-intervention-list">{entries.map(renderIntervention)}</div> : <p>{t("growth.interventionsGroupEmpty")}</p>}
            </section>
          );
        })}
        {(() => {
          const dismissed = filtered.filter((intervention) => intervention.status === "dismissed");
          return (
            <section className="growth-intervention-group status-dismissed">
              <button className="growth-intervention-group-toggle" type="button" aria-expanded={dismissedOpen} onClick={() => setDismissedOpen((open) => !open)}>
                <span><strong>{t(statusKeys.dismissed)}</strong><small>{dismissed.length}</small></span>
                <span aria-hidden="true">{dismissedOpen ? "−" : "+"}</span>
              </button>
              {dismissedOpen ? (
                dismissed.length ? <div className="growth-intervention-list">{dismissed.map(renderIntervention)}</div> : <p>{t("growth.interventionsGroupEmpty")}</p>
              ) : null}
            </section>
          );
        })()}
      </div>
    </section>
  );
}
