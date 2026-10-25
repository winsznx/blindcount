"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { loadDevice } from "@/lib/device";
import { syncAllPending } from "@/lib/field";

/**
 * Uploads finalizations signed while offline. Runs when the app opens and every time the
 * browser comes back online, so an auditor never has to remember to press anything.
 */
export function FieldSync({ org, userId }: { org: string; userId: string }) {
  const qc = useQueryClient();
  // Subscribing to the browser's online event and syncing an external store is effect territory.
  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        const device = await loadDevice(org, userId);
        if (!device?.deviceKeyId) return;
        const { synced } = await syncAllPending(device);
        if (synced.length) {
          await Promise.all([qc.invalidateQueries({ queryKey: ["visits", org] }), qc.invalidateQueries({ queryKey: ["visit"] }), qc.invalidateQueries({ queryKey: ["visit-local"] }), qc.invalidateQueries({ queryKey: ["pending-on-device"] })]);
        }
      } catch {
        // Each finalization records its own failure; the next reconnect or app start retries.
      } finally {
        running = false;
      }
    };
    void run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [org, userId, qc]);
  return null;
}
