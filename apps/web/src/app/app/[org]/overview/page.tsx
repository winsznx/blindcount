"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { get } from "@/lib/api";
import type { CohortView, Programme } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { CohortStatus } from "@/components/status";
import { Empty, ErrorState, Loading } from "@/components/states";
import { has, useOrgRoles } from "@/components/use-me";
import { formatDate } from "@/lib/format";
import styles from "./overview.module.css";

interface AuditEvent {
  id: string;
  action: string;
  objectType: string;
  recordedAt: string;
}

export default function Overview() {
  const org = useOrg();
  const { roles, orgName } = useOrgRoles(org);
  const programmes = useQuery({ queryKey: ["programmes", org], queryFn: () => get<Programme[]>(`/v1/organizations/${org}/programmes`), enabled: has(roles, "OWNER", "MANAGER", "REVIEWER") });
  const cohortIds = (programmes.data ?? []).flatMap((p) => p.cohorts.map((c) => c.id));
  const cohorts = useQueries({ queries: cohortIds.map((id) => ({ queryKey: ["cohort", id], queryFn: () => get<CohortView>(`/v1/cohorts/${id}`) })) });
  const activity = useQuery({ queryKey: ["audit", org], queryFn: () => get<AuditEvent[]>(`/v1/organizations/${org}/audit-events`), enabled: has(roles, "OWNER", "MANAGER") });

  const all = cohorts.map((c) => c.data).filter((c): c is CohortView => !!c);
  const assignments = all.flatMap((c) => c.assignments);
  const count = (...s: string[]) => assignments.filter((a) => s.includes(a.status)).length;
  const tiles = [
    { label: "Awaiting audit", value: count("PENDING", "IN_PROGRESS", "EXPIRED") },
    { label: "Anchoring", value: count("ANCHOR_PENDING", "RECEIVED", "ANCHOR_FAILED") },
    { label: "Sealed", value: count("SEALED") },
    { label: "Needs review", value: count("REVIEW_PENDING", "AMENDMENT_REQUESTED") },
    { label: "Approved", value: count("APPROVED") },
  ];
  const isManager = has(roles, "MANAGER");

  return (
    <>
      <PageHeader
        title={orgName ?? "Overview"}
        description="Field progress across every cohort. Counts come from the authoritative database and chain-confirmed anchors."
        actions={isManager ? (
          <Link href={`/app/${org}/programmes/new`} className="btn btn-primary">
            <Plus aria-hidden="true" /> New programme
          </Link>
        ) : null}
      />
      {programmes.isLoading ? (
        <Loading />
      ) : programmes.error ? (
        <ErrorState error={programmes.error} onRetry={() => programmes.refetch()} />
      ) : !programmes.data?.length ? (
        <Empty title="No programmes yet" action={isManager ? <Link className="btn btn-primary" href={`/app/${org}/programmes/new`}>Create a programme</Link> : null}>
          A programme groups cohorts of field inspections for one crop and region. {isManager ? "Start one to set a hidden criterion and assign auditors." : "A manager will set one up."}
        </Empty>
      ) : (
        <div className="stack-lg">
          <section className={styles.tiles} aria-label="Assignment totals">
            {tiles.map((t) => (
              <div key={t.label} className={styles.tile}>
                <span className={`${styles.tileValue} num`}>{t.value}</span>
                <span className={styles.tileLabel}>{t.label}</span>
              </div>
            ))}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 style={{ fontSize: 17 }}>Cohorts</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cohort</th>
                    <th>Programme</th>
                    <th>Progress</th>
                    <th>Due</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {programmes.data.flatMap((p) =>
                    p.cohorts.map((c) => {
                      const v = all.find((x) => x.id === c.id);
                      const done = v ? v.assignments.filter((a) => !["PENDING", "IN_PROGRESS", "EXPIRED", "ANCHOR_PENDING", "RECEIVED", "ANCHOR_FAILED", "VOID_PENDING"].includes(a.status)).length : 0;
                      return (
                        <tr key={c.id}>
                          <td>
                            <Link href={`/app/${org}/cohorts/${c.id}`} style={{ fontWeight: 550 }}>
                              {c.name}
                            </Link>
                            <div className="subtle" style={{ fontSize: 12.5 }}>{c.code}</div>
                          </td>
                          <td className="muted">{p.name}</td>
                          <td>
                            <div className={styles.bar} aria-label={`${done} of ${c.expectedCount} terminal`}>
                              <span style={{ width: `${c.expectedCount ? (done / c.expectedCount) * 100 : 0}%` }} />
                            </div>
                            <span className="subtle num" style={{ fontSize: 12.5 }}>
                              {done} of {c.expectedCount} sealed or voided
                            </span>
                          </td>
                          <td className="muted">{formatDate(c.dueAt)}</td>
                          <td>
                            <CohortStatus state={c.state} />
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {activity.data?.length ? (
            <section className="panel">
              <div className="panel-head">
                <h2 style={{ fontSize: 17 }}>Recent activity</h2>
                <Link href={`/app/${org}/settings/security`} className="btn btn-ghost">View audit trail</Link>
              </div>
              <ul className={styles.activity}>
                {activity.data.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <span>{e.action.replace(/[._]/g, " ")}</span>
                    <time className="subtle" dateTime={e.recordedAt}>{formatDate(e.recordedAt, true)}</time>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
