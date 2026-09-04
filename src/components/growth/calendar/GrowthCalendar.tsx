import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchGrowthContentItems, fetchGrowthProfile } from "../../../api/growth";
import { useI18n } from "../../../i18n/I18nProvider";
import type { GrowthContentItem, GrowthProfile } from "../../../types/growth";
import {
  buildGrowthCalendarMonth,
  calendarDateInTimezone,
  groupGrowthCalendarItems,
  growthCalendarUtcRange,
  normalizeCalendarDate,
  shiftCalendarMonth,
} from "../../../utils/growth/calendar";
import { ContentItemDrawer } from "../ContentItemDrawer";
import { GrowthCalendarMonth } from "./GrowthCalendarMonth";

interface GrowthCalendarProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function GrowthCalendar({ accountId, enabled, repository }: GrowthCalendarProps) {
  const { language, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const search = new URLSearchParams(location.search);
  const rawDate = search.get("date");
  const view = search.get("view");
  const [loadedProfile, setLoadedProfile] = useState<{
    accountId: string;
    repository: string;
    value: GrowthProfile;
  } | null>(null);
  const profile = loadedProfile?.accountId === accountId && loadedProfile.repository === repository
    ? loadedProfile.value
    : null;
  const [items, setItems] = useState<GrowthContentItem[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedItem, setSelectedItem] = useState<GrowthContentItem | null>(null);

  const today = profile
    ? calendarDateInTimezone(new Date(), profile.timezone)
    : utcToday();
  const selectedDate = normalizeCalendarDate(rawDate, today);
  const grid = useMemo(() => buildGrowthCalendarMonth(selectedDate), [selectedDate]);

  useEffect(() => {
    setLoadedProfile(null);
    setItems([]);
    setSelectedItem(null);
    setError("");
    if (!enabled || !accountId || !repository) {
      setProfileLoading(false);
      return;
    }

    const controller = new AbortController();
    setProfileLoading(true);
    void fetchGrowthProfile(repository, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setLoadedProfile({ accountId, repository, value: result });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setError((cause as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false);
      });
    return () => controller.abort();
  }, [accountId, enabled, repository]);

  useEffect(() => {
    if (view === "month" && rawDate === selectedDate) return;
    const canonical = new URLSearchParams();
    canonical.set("view", "month");
    canonical.set("date", selectedDate);
    navigate(`${location.pathname}?${canonical.toString()}`, { replace: true });
  }, [location.pathname, navigate, rawDate, selectedDate, view]);

  useEffect(() => {
    setItems([]);
    setSelectedItem(null);
    if (!enabled || !accountId || !repository || !profile) {
      setItemsLoading(false);
      return;
    }

    const controller = new AbortController();
    const range = growthCalendarUtcRange(grid, profile.timezone);
    setItemsLoading(true);
    setError("");
    void fetchGrowthContentItems({ repository, ...range }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setItems(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setError((cause as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setItemsLoading(false);
      });
    return () => controller.abort();
  }, [accountId, enabled, grid, profile, repository]);

  const itemsByDate = useMemo(
    () => groupGrowthCalendarItems(items, profile?.timezone ?? "UTC"),
    [items, profile?.timezone],
  );
  const visibleItemCount = grid.days.reduce((count, day) => count + (itemsByDate.get(day.date)?.length ?? 0), 0);
  const pillarLabels = useMemo(
    () => new Map(profile?.pillars.map((pillar) => [pillar.id, pillar.label]) ?? []),
    [profile?.pillars],
  );
  const monthLabel = new Intl.DateTimeFormat(language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${grid.monthStart}T12:00:00.000Z`));
  const loading = profileLoading || itemsLoading;

  function navigateDate(date: string) {
    const next = new URLSearchParams();
    next.set("view", "month");
    next.set("date", date);
    navigate(`${location.pathname}?${next.toString()}`);
  }

  function updateItem(updated: GrowthContentItem) {
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedItem(updated);
  }

  return (
    <section className="growth-calendar" aria-busy={loading}>
      <header className="growth-calendar-hero">
        <div>
          <span>{t("growth.calendarEyebrow")}</span>
          <h1>{t("growth.calendarTitle")}</h1>
          <p>{t("growth.calendarDescription", { repository })}</p>
        </div>
        {profile ? (
          <div className="growth-calendar-timezone">
            <span aria-hidden="true" style={{ backgroundColor: profile.color }} />
            <small>{t("growth.calendarTimezone", { timezone: profile.timezone })}</small>
          </div>
        ) : null}
      </header>

      <div className="growth-calendar-toolbar">
        <div className="growth-calendar-navigation">
          <button className="btn ghost" type="button" disabled={!profile} onClick={() => navigateDate(shiftCalendarMonth(selectedDate, -1))}>
            <span aria-hidden="true">←</span> {t("growth.calendarPreviousMonth")}
          </button>
          <button className="btn ghost" type="button" disabled={!profile} onClick={() => navigateDate(today)}>{t("growth.calendarToday")}</button>
          <button className="btn ghost" type="button" disabled={!profile} onClick={() => navigateDate(shiftCalendarMonth(selectedDate, 1))}>
            {t("growth.calendarNextMonth")} <span aria-hidden="true">→</span>
          </button>
        </div>
        <h2>{monthLabel}</h2>
      </div>

      {loading ? <div className="growth-calendar-state" role="status">{t("growth.calendarLoading")}</div> : null}
      {error ? <div className="growth-calendar-error" role="alert">{t("growth.calendarError", { message: error })}</div> : null}
      {!loading && !error && profile && visibleItemCount === 0 ? (
        <div className="growth-calendar-empty">
          <strong>{t("growth.calendarEmptyTitle")}</strong>
          <p>{t("growth.calendarEmptyDescription")}</p>
        </div>
      ) : null}

      {profile ? (
        <GrowthCalendarMonth
          grid={grid}
          itemsByDate={itemsByDate}
          timezone={profile.timezone}
          color={profile.color}
          pillarLabels={pillarLabels}
          onOpenItem={setSelectedItem}
        />
      ) : null}

      {selectedItem ? (
        <ContentItemDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdate={updateItem}
        />
      ) : null}
    </section>
  );
}
