"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { get } from "@/lib/api";
import type { Programme } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { Empty, ErrorState, Loading } from "@/components/states";
import { has, useOrgRoles } from "@/components/use-me";
import { formatDate } from "@/lib/format";

export default function Programmes() {
  const org = useOrg();
  const { roles } = useOrgRoles(org);
  const q = useQuery({ queryKey: ["programmes", org], queryFn: () => get<Programme[]>(`/v1/organizations/${org}/programmes`) });
  const isManager = has(roles, "MANAGER");
  return (
    <>
      <PageHeader title="Programmes" description="Each programme covers one crop, region and reporting period." actions={isManager ? <Link className="btn btn-primary" href={`/app/${org}/programmes/new`}><Plus aria-hidden="true" /> New programme</Link> : null} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <Empty title="No programmes yet">Create a programme to start your first blind cohort.</Empty>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Programme</th><th>Crop and region</th><th>Period</th><th>Cohorts</th><th>Data</th></tr></thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/app/${org}/programmes/${p.id}`} style={{ fontWeight: 550 }}>{p.name}</Link><div className="subtle" style={{ fontSize: 12.5 }}>{p.code}</div></td>
                  <td className="muted">{p.crop}, {p.regionLabel}</td>
                  <td className="muted">{formatDate(p.startAt)} – {formatDate(p.endAt)}</td>
                  <td className="num">{p.cohorts.length}</td>
                  <td>{p.dataSource === "SIMULATED_DEMO" ? <span className="status status-pending">Simulated</span> : <span className="status">Field data</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
