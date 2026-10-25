"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { Status } from "@/components/status";
import { Empty, ErrorState, Loading } from "@/components/states";
import { formatDate, titleCase } from "@/lib/format";

interface ReportRow { id: string; version: number; status: string; generatedAt: string; assignmentCode: string; farmPseudonym: string; cohortCode: string }

export default function Reports() {
  const org = useOrg();
  const q = useQuery({ queryKey: ["reports", org], queryFn: () => get<ReportRow[]>(`/v1/organizations/${org}/reports`) });
  return (
    <>
      <PageHeader title="Reports" description="Field verification reports and their portable proof packets." />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <Empty title="No reports yet">Generate a report from a reviewed observation in the review desk.</Empty>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Farm</th><th>Cohort</th><th>Version</th><th>Generated</th><th>Status</th></tr></thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/app/${org}/reports/${r.id}`} style={{ fontWeight: 550 }}>{r.farmPseudonym}</Link><div className="subtle" style={{ fontSize: 12.5 }}>{r.assignmentCode}</div></td>
                  <td className="muted">{r.cohortCode}</td>
                  <td className="num">v{r.version}</td>
                  <td className="muted">{formatDate(r.generatedAt, true)}</td>
                  <td><Status tone={r.status === "APPROVED" ? "success" : r.status === "DISPUTED" ? "error" : "pending"}>{titleCase(r.status)}</Status></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
