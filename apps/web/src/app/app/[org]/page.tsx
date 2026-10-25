"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOrg } from "@/lib/use-org";
import { useOrgRoles } from "@/components/use-me";

/** Routes each person to where their work is: auditors to visits, everyone else to the overview. */
export default function OrgIndex() {
  const org = useOrg();
  const router = useRouter();
  const { roles, loading } = useOrgRoles(org);
  useEffect(() => {
    if (loading || !roles.length) return;
    router.replace(`/app/${org}/${roles.every((r) => r === "AUDITOR") ? "visits" : "overview"}`);
  }, [loading, roles.join(","), org, router]); // eslint-disable-line react-hooks/exhaustive-deps -- roles is a fresh array each render
  return null;
}
