"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ApiFailure } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { Logo } from "@/components/logo";

/** Role-based landing: auditors go to their visits, everyone else to the overview. */
export default function AppIndex() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.error instanceof ApiFailure && me.error.status === 401) return router.replace("/sign-in");
    if (!me.data) return;
    const first = me.data.memberships[0];
    if (!first) return router.replace("/onboarding");
    const fieldOnly = first.roles.every((r) => r === "AUDITOR");
    router.replace(`/app/${first.organization.id}/${fieldOnly ? "visits" : "overview"}`);
  }, [me.data, me.error, router]);
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", opacity: 0.6 }} aria-busy="true">
      <Logo />
    </div>
  );
}
