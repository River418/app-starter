import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000,
      retry: (failure, error) =>
        failure < 1 &&
        !(error instanceof ApiError && [401, 403].includes(error.status)),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
