import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <AppShell org={org}>{children}</AppShell>;
}
