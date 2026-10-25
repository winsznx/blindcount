"use client";

import { useParams } from "next/navigation";

export function useOrg(): string {
  const p = useParams<{ org: string }>();
  return p.org;
}
