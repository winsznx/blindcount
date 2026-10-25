"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { get } from "@/lib/api";
import type { Programme } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { CohortStatus } from "@/components/status";
import { Empty, ErrorState, Loading } from "@/components/states";
import { has, useOrgRoles } from "@/components/use-me";
import { formatDate } from "@/lib/format";

export default function ProgrammeDetail() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const { roles } = useOrgRoles(org);
  const q = useQuery({ queryKey: ["programme", id], queryFn: () => get<Programme>(`/v1/programmes/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const isManager = has(roles, "MANAGER");
  return (
    <>
      <PageHeader
        title={p.name}
        back={{ href: `/app/${org}/programmes`, label: "Programmes" }}
        description={`${p.crop}, ${p.regionLabel}. ${formatDate(p.startAt)} to ${formatDate(p.endAt)}.`}
        actions={isManager ? <Link className="btn btn-primary" href={`/app/${org}/cohorts/new?programme=${p.id}`}><Plus aria-hidden="true" /> New cohort</Link> : null}
      />
      <div className="stack-lg">
        <div className="panel panel-pad">
          <dl className="kv">
            <dt>Code</dt><dd>{p.code}</dd>
            <dt>Purpose</dt><dd>{p.purpose}</dd>
            <dt>Data source</dt><dd>{p.dataSource === "SIMULATED_DEMO" ? "Simulated demo data (not real field measurements)" : "Consented field data"}</dd>
          </dl>
        </div>
        {p.cohorts.length === 0 ? (
          <Empty title="No cohorts yet">A cohort is the unit of concealment. Its target stays hidden until every assignment in it is sealed or voided.</Empty>
        ) : (
          <div className="panel table-wrap">
            <table className="table">
              <thead><tr><th>Cohort</th><th>Assignments</th><th>Due</th><th>State</th></tr></thead>
              <tbody>
                {p.cohorts.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/app/${org}/cohorts/${c.id}`} style={{ fontWeight: 550 }}>{c.name}</Link><div className="subtle" style={{ fontSize: 12.5 }}>{c.code}</div></td>
                    <td className="num">{c.expectedCount}</td>
                    <td className="muted">{formatDate(c.dueAt)}</td>
                    <td><CohortStatus state={c.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
