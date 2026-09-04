import type { CSSProperties } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import type { GrowthContentItem } from "../../../types/growth";
import type { GrowthCalendarMonthGrid } from "../../../utils/growth/calendar";

interface GrowthCalendarMonthProps {
  grid: GrowthCalendarMonthGrid;
  itemsByDate: ReadonlyMap<string, GrowthContentItem[]>;
  timezone: string;
  color: string;
  pillarLabels: ReadonlyMap<string, string>;
  onOpenItem: (item: GrowthContentItem) => void;
}

function itemTitle(item: GrowthContentItem): string {
  return item.title || item.angle || item.format;
}

export function GrowthCalendarMonth({
  grid,
  itemsByDate,
  timezone,
  color,
  pillarLabels,
  onOpenItem,
}: GrowthCalendarMonthProps) {
  const { language, t } = useI18n();
  const monthLabel = new Intl.DateTimeFormat(language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${grid.monthStart}T12:00:00.000Z`));
  const timeFormatter = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });
  const dateFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => t(`growth.weekday.${index + 1}` as TranslationKey));
  const calendarStyle = { "--growth-calendar-color": color } as CSSProperties;

  return (
    <section className="growth-calendar-month" aria-label={monthLabel} style={calendarStyle}>
      <div className="growth-calendar-scroll">
        <div className="growth-calendar-weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => <span key={label} title={label}>{label.slice(0, 3)}</span>)}
        </div>
        <div className="growth-calendar-grid">
          {grid.days.map((day) => {
            const dayItems = itemsByDate.get(day.date) ?? [];
            const formattedDate = dateFormatter.format(new Date(`${day.date}T12:00:00.000Z`));
            return (
              <section
                className={`growth-calendar-day${day.inCurrentMonth ? "" : " outside-month"}`}
                key={day.date}
                aria-label={formattedDate}
              >
                <header>
                  <time dateTime={day.date}>{day.dayOfMonth}</time>
                </header>
                <div className="growth-calendar-day-items">
                  {dayItems.map((item) => {
                    const title = itemTitle(item);
                    const pillar = item.pillar ? pillarLabels.get(item.pillar) ?? item.pillar : "";
                    return (
                      <button
                        className={`growth-calendar-item status-${item.status}`}
                        type="button"
                        key={item.id}
                        onClick={() => onOpenItem(item)}
                        aria-label={t("growth.calendarOpenItem", { title, date: formattedDate })}
                      >
                        <span className="growth-calendar-item-time">
                          {timeFormatter.format(new Date(item.scheduledFor!))}
                        </span>
                        <strong>{title}</strong>
                        <span className="growth-calendar-item-indicators">
                          <small className="growth-calendar-item-channel">
                            {t(`growth.channel.${item.channel}` as TranslationKey)}
                          </small>
                          <small>{t(`growth.status.${item.status}` as TranslationKey)}</small>
                          {pillar ? <small className="growth-calendar-item-pillar">{pillar}</small> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
