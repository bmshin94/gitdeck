import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { App } from "./App";
import { GrowthStudioApp } from "./components/growth/GrowthStudioApp";
import { AccountProvider } from "./contexts/AccountContext";
import { I18nProvider } from "./i18n/I18nProvider";
import "./styles.css";

function RouteAwareApp() {
  const { pathname } = useLocation();
  const isGrowthRoute = pathname === "/growth" || pathname.startsWith("/growth/");

  return isGrowthRoute ? <GrowthStudioApp /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <AccountProvider>
      <BrowserRouter>
        <RouteAwareApp />
      </BrowserRouter>
    </AccountProvider>
  </I18nProvider>,
);
