"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ChevronRight, MapPin } from "lucide-react";
import { get } from "@/lib/api";
import type { VisitForm } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader, useOnline } from "@/components/app-shell";
import { AssignmentStatus } from "@/components/status";
import { Empty, ErrorState, Loading } from "@/components/states";
import { formatDate } from "@/lib/format";
import { useMe } from "@/components/use-me";
import { loadDevice } from "@/lib/device";
import { pendingOnDevice } from "@/lib/field";
import styles from "./visits.module.css";

export default function Visits() {
  const org = useOrg();
  const online = useOnline();
  const me = useMe();
  const q = useQuery({ queryKey: ["visits", org], queryFn: () => get<VisitForm[]>(`/v1/assignments?orgId=${org}`), refetchInterval: 10_000 });
  const pending = useQuery({
    queryKey: ["pending-on-device", org, me.data?.id],
    enabled: !!me.data,
    networkMode: "always",
    queryFn: async () => {
      const device = await loadDevice(org, me.data!.id);
      return new Set(device ? await pendingOnDevice(device) : []);
    },
  });
  const waiting = pending.data ?? new Set<string>();
  const open = (q.data ?? []).filter((v) => !v.submissions.length && !waiting.has(v.assignmentId));
  const done = (q.data ?? []).filter((v) => v.submissions.length || waiting.has(v.assignmentId));

  return (
    <>
      <PageHeader title="My visits" description="Count what you observe. Programme targets are intentionally hidden from field staff." />
      {!online ? <div className="notice notice-pending" style={{ marginBottom: 16 }}>You&apos;re offline. Visits you opened while online can still be filled in and finalized on this device. They upload automatically when you reconnect.</div> : null}
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <Empty title="No visits assigned">When a manager publishes a cohort with you on the roster, your visits appear here.</Empty>
      ) : (
        <div className="stack-lg">
          {open.length ? (
            <section className="stack-sm">
              <h2 style={{ fontSize: 15 }} className="muted">To do</h2>
              <ul className={styles.list}>{open.map((v) => <VisitCard key={v.assignmentId} org={org} v={v} />)}</ul>
            </section>
          ) : null}
          {done.length ? (
            <section className="stack-sm">
              <h2 style={{ fontSize: 15 }} className="muted">Submitted</h2>
              <ul className={styles.list}>{done.map((v) => <VisitCard key={v.assignmentId} org={org} v={v} waiting={waiting.has(v.assignmentId) && !v.submissions.length} />)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

function VisitCard({ org, v, waiting = false }: { org: string; v: VisitForm; waiting?: boolean }) {
  return (
    <li>
      <Link href={`/app/${org}/visits/${v.assignmentId}`} className={styles.card}>
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10 }}>
            <strong className={styles.farm}>{v.farm.pseudonym}</strong>
            {waiting ? <span className="status status-pending">Waiting to upload</span> : <AssignmentStatus status={v.status === "PENDING" && v.late ? "EXPIRED" : v.status} />}
          </div>
          <div className={styles.meta}>
            <span><Calendar size={14} aria-hidden="true" /> Due {formatDate(v.dueAt)}</span>
            {v.farm.coarseRegion ? <span><MapPin size={14} aria-hidden="true" /> {v.farm.coarseRegion}</span> : null}
            <span>{v.programme.name}</span>
          </div>
        </div>
        <span className={styles.go}>{v.submissions.length || waiting ? "View receipt" : "Start visit"} <ChevronRight size={16} aria-hidden="true" /></span>
      </Link>
    </li>
  );
}
