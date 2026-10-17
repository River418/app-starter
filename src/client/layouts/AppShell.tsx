import { useState } from "react";
import {
  NavLink,
  Outlet,
  useLoaderData,
  useNavigate,
  useRouteLoaderData,
} from "react-router";
import { FileText, Users, Menu, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { auth } from "../lib/auth";
import { queryClient } from "../lib/query";
import { Controls } from "./Root";
import { Button, Modal } from "../components/ui";
import type { Identity } from "../../shared/identity";
import type { PublicConfig } from "../../shared/config";

export function AppShell() {
  const identity = useLoaderData() as Identity;
  const config = useRouteLoaderData("root") as PublicConfig;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const navigation = (
    <nav aria-label={t("workspace")}>
      <NavLink to="/app/records" onClick={() => setOpen(false)}>
        <FileText size={18} />
        {t("records")}
      </NavLink>
      {identity.role === "admin" && (
        <>
          <span className="nav-caption">{t("admin")}</span>
          <NavLink to="/app/admin/users" onClick={() => setOpen(false)}>
            <Users size={18} />
            {t("users")}
          </NavLink>
        </>
      )}
    </nav>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand" to="/app/records">
          <span className="brand-mark">a</span>
          {config.title}
        </NavLink>
        {navigation}
        <div className="sidebar-footer">{t("workspace")}</div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <Button
            variant="ghost"
            className="mobile-menu"
            aria-label={t("openNav")}
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </Button>
          <span className="account-email">{identity.email}</span>
          <Controls />
          <Button
            variant="ghost"
            aria-label={t("signOut")}
            onClick={async () => {
              const result = await auth().auth.signOut();
              if (result.error) throw result.error;
              queryClient.clear();
              setOpen(false);
              navigate("/login", { replace: true });
            }}
          >
            <LogOut size={17} />
            <span className="logout-label">{t("signOut")}</span>
          </Button>
        </header>
        <main className="workspace" key={identity.userId}>
          <Outlet context={identity} />
        </main>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={config.title}
        closeLabel={t("closeNav")}
      >
        {navigation}
      </Modal>
    </div>
  );
}
