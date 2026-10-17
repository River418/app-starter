import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query";
import { router } from "./router";
import "./lib/i18n";
import "./styles.css";
document.documentElement.dataset.theme =
  localStorage.getItem("theme") ||
  (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light");
document.documentElement.lang = localStorage.getItem("language") || "en";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
