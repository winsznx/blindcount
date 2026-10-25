"use client";

import { useEffect } from "react";

export function ServiceWorker() {
  // Registering the worker is a side effect on an external system (the browser), so an effect is correct here.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
