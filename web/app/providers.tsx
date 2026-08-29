"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 3, refetchOnReconnect: true },
          // Mutations must NOT auto-retry: nearly every mutation in this app is a
          // non-idempotent POST (create account/transaction/goal/category/recurring
          // item/rule). If the server-side write succeeds but the response is lost
          // (dropped connection, timeout), an automatic retry re-sends the same
          // create request and produces a duplicate record with no dedup guard
          // outside of transactions (see duplicate-detection.ts, which only covers
          // POST /transactions). Confirmed via manual edge-case testing: stopping
          // the API mid-request and clicking "Add" once fired two POST /goals
          // requests (retry: 1's extra attempt) that would have created two goals
          // had the first write actually landed before the connection dropped.
          mutations: { retry: 0 },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
