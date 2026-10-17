import { createBrowserRouter, redirect } from "react-router";
import { Root, PublicLayout } from "./layouts/Root";
import { AppShell } from "./layouts/AppShell";
import { ErrorPage } from "./pages/common";
import { api, ApiError } from "./lib/api";
import { configureAuth } from "./lib/auth";
import { queryClient } from "./lib/query";
import type { PublicConfig } from "../shared/config";
import type { Identity } from "../shared/identity";

async function identity(admin = false) {
  try {
    const value = await queryClient.fetchQuery({
      queryKey: ["session"],
      queryFn: () => api<Identity>("/api/session"),
      staleTime: 0,
    });
    if (admin && value.role !== "admin")
      throw new Response("Application access denied", { status: 403 });
    return value;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw redirect("/login");
    throw error;
  }
}
export const router = createBrowserRouter([
  {
    id: "root",
    path: "/",
    Component: Root,
    ErrorBoundary: ErrorPage,
    loader: async () => {
      const config = await api<PublicConfig>("/api/config");
      configureAuth(config);
      return config;
    },
    children: [
      {
        Component: PublicLayout,
        children: [
          {
            path: "pricing",
            lazy: async () => ({
              Component: (
                await import("../features/billing/client/PricingPage")
              ).PricingPage,
            }),
          },
          {
            index: true,
            lazy: async () => ({
              Component: (await import("./pages/common")).HomePage,
            }),
          },
          {
            path: "login",
            lazy: async () => ({
              Component: (await import("./pages/auth/Forms")).LoginPage,
            }),
          },
          {
            path: "sign-up",
            lazy: async () => ({
              Component: (await import("./pages/auth/Forms")).SignUpPage,
            }),
          },
          {
            path: "reset-password",
            lazy: async () => ({
              Component: (await import("./pages/auth/Forms")).ResetPasswordPage,
            }),
          },
          {
            path: "auth/confirm",
            lazy: async () => ({
              Component: (await import("./pages/auth/Forms")).ConfirmPage,
            }),
          },
          {
            path: "bootstrap",
            lazy: async () => ({
              Component: (await import("./pages/auth/Forms")).BootstrapPage,
            }),
          },
        ],
      },
      {
        id: "app",
        path: "app",
        Component: AppShell,
        ErrorBoundary: ErrorPage,
        loader: () => identity(),
        children: [
          { index: true, loader: () => redirect("/app/records") },
          {
            path: "pricing",
            lazy: async () => ({
              Component: (
                await import("../features/billing/client/PricingPage")
              ).PricingPage,
            }),
          },
          {
            path: "billing",
            lazy: async () => ({
              Component: (
                await import("../features/billing/client/BillingPage")
              ).BillingPage,
            }),
          },
          {
            path: "billing/return",
            lazy: async () => ({
              Component: (
                await import("../features/billing/client/PaymentReturnPage")
              ).PaymentReturnPage,
            }),
          },
          {
            path: "admin/billing",
            loader: () => identity(true),
            lazy: async () => ({
              Component: (
                await import("../features/billing/client/AdminBillingPage")
              ).AdminBillingPage,
            }),
          },
          {
            path: "records",
            lazy: async () => ({
              Component: (
                await import("../features/records/client/RecordsPage")
              ).RecordsPage,
            }),
          },
          {
            path: "admin/users",
            loader: () => identity(true),
            lazy: async () => ({
              Component: (await import("./pages/admin/UsersPage")).UsersPage,
            }),
          },
        ],
      },
      {
        path: "*",
        lazy: async () => ({
          Component: (await import("./pages/common")).NotFoundPage,
        }),
      },
    ],
  },
]);
