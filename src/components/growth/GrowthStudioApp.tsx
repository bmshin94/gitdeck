import { useI18n } from "../../i18n/I18nProvider";

export function GrowthStudioApp() {
  const { t } = useI18n();

  return <h1>{t("goals.growthStudio")}</h1>;
}
