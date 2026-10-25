"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiFailure, get, type Me, type Role } from "@/lib/api";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/v1/auth/me"), retry: (n, e) => !(e instanceof ApiFailure && e.status === 401) && n < 2 });
}

export function useOrgRoles(orgId: string): { roles: Role[]; orgName: string | null; loading: boolean } {
  const me = useMe();
  const m = me.data?.memberships.find((x) => x.organization.id === orgId);
  return { roles: m?.roles ?? [], orgName: m?.organization.name ?? null, loading: me.isLoading };
}

export const has = (roles: Role[], ...want: Role[]) => want.some((r) => roles.includes(r));
