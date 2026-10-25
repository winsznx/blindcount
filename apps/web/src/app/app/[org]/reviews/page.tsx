"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type { Programme } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { OutcomeStatus, Status } from "@/components/status";
import { Empty, ErrorState, Loading } from "@/components/states";

interface Case {
  id: string;
  state: string;
  decision: string | null;
  assignmentCode: string;
  farmPseudonym: string;
  originalCount: number | null;
  outcome: string | null;
  flagCount: number;
  ownSubmission: boolean;
}

const STATE: Record<string, { tone: "pending" | "success" | "error"; label: string }> = {
  OPEN: { tone: "pending", label: "Needs review" },
  APPROVED: { tone: "success", label: "Approved" },
  DISPUTED: { tone: "error", label: "Disputed" },
  CORRECTION_REQUESTED: { tone: "pending", label: "Correction requested" },
};

export default function Reviews() {
  const org = useOrg();
  const programmes = useQuery({ queryKey: ["programmes", org], queryFn: () => get<Programme[]>(`/v1/organizations/${org}/programmes`) });
  const cohorts = (programmes.data ?? []).flatMap((p) => p.cohorts.filter((c) => c.state === "DISCLOSED" || c.state === "ARCHIVED"));
  const queues = useQueries({ queries: cohorts.map((c) => ({ queryKey: ["reviews", c.id], queryFn: () => get<Case[]>(`/v1/cohorts/${c.id}/reviews`) })) });

  return (
    <>
      <PageHeader title="Review desk" description="Evidence review opens after a cohort is closed and its criterion disclosed. Flags are prompts for your judgement, never findings." />
      {programmes.isLoading ? <Loading /> : programmes.error ? <ErrorState error={programmes.error} /> : !cohorts.length ? (
        <Empty title="Nothing to review yet">Reviews appear here once every assignment in a cohort is sealed, the cohort is closed onchain and the custodian discloses the criterion.</Empty>
      ) : (
        <div className="stack-lg">
          {cohorts.map((c, i) => {
            const q = queues[i];
            const open = (q?.data ?? []).filter((x) => x.state === "OPEN").length;
            return (
              <section key={c.id} className="panel">
                <div className="panel-head">
                  <div><h2 style={{ fontSize: 17 }}>{c.name}</h2><span className="subtle" style={{ fontSize: 13 }}>{c.code}</span></div>
                  <span className="subtle num">{open} open</span>
                </div>
                {q?.isLoading ? <div className="panel-pad"><Loading rows={2} /></div> : q?.error ? <div className="panel-pad"><ErrorState error={q.error} /></div> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Farm</th><th>Original count</th><th>Outcome</th><th>Flags</th><th>State</th></tr></thead>
                      <tbody>
                        {(q?.data ?? []).map((r) => (
                          <tr key={r.id}>
                            <td>{r.ownSubmission ? <span>{r.farmPseudonym} <span className="subtle">(your submission)</span></span> : <Link href={`/app/${org}/reviews/${r.id}`} style={{ fontWeight: 550 }}>{r.farmPseudonym}</Link>}<div className="subtle" style={{ fontSize: 12.5 }}>{r.assignmentCode}</div></td>
                            <td className="num">{r.originalCount ?? "—"}</td>
                            <td><OutcomeStatus outcome={r.outcome} /></td>
                            <td className="num">{r.flagCount ? <Status tone="pending">{`${r.flagCount} to check`}</Status> : <span className="subtle">None</span>}</td>
                            <td><Status tone={STATE[r.state]?.tone ?? "pending"}>{STATE[r.state]?.label ?? r.state}</Status></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
