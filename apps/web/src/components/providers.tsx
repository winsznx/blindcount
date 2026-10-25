"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiFailure } from "@/lib/api";
import { ServiceWorker } from "./service-worker";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: (count, e) => (e instanceof ApiFailure && !e.retryable ? false : count < 2),
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ServiceWorker />
      {children}
    </QueryClientProvider>
  );
}
