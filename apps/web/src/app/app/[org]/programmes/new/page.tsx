"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";

export default function NewProgramme() {
  const org = useOrg();
  const router = useRouter();
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [f, setF] = useState({ code: `STM-${year}`, name: `Shade Tree Monitoring ${year}`, crop: "Cocoa", regionLabel: "", purpose: "Verify minimum shade-tree counts on enrolled farms.", startAt: `${year}-01-01`, endAt: `${year}-12-31`, dataSource: "SIMULATED_DEMO" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api<{ id: string }>("POST", `/v1/organizations/${org}/programmes`, { ...f, code: f.code.toUpperCase() });
      await qc.invalidateQueries({ queryKey: ["programmes", org] });
      router.push(`/app/${org}/programmes/${p.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New programme" back={{ href: `/app/${org}/programmes`, label: "Programmes" }} />
      <form className="panel panel-pad stack" style={{ maxWidth: 720 }} onSubmit={submit}>
        {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: "0 0 180px" }}><label htmlFor="code">Code</label><input id="code" className="input" required value={f.code} onChange={set("code")} /><span className="hint">Uppercase, digits, hyphens</span></div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}><label htmlFor="name">Name</label><input id="name" className="input" required value={f.name} onChange={set("name")} /></div>
        </div>
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="crop">Crop</label><input id="crop" className="input" required value={f.crop} onChange={set("crop")} /></div>
          <div className="field" style={{ flex: 2, minWidth: 220 }}><label htmlFor="region">Region</label><input id="region" className="input" required placeholder="Coarse region only, never a farm address" value={f.regionLabel} onChange={set("regionLabel")} /></div>
        </div>
        <div className="field"><label htmlFor="purpose">Purpose</label><textarea id="purpose" className="textarea" required value={f.purpose} onChange={set("purpose")} /></div>
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="start">Period start</label><input id="start" type="date" className="input" required value={f.startAt} onChange={set("startAt")} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="end">Period end</label><input id="end" type="date" className="input" required value={f.endAt} onChange={set("endAt")} /></div>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>Data source</legend>
          <label className="check"><input type="radio" name="ds" checked={f.dataSource === "SIMULATED_DEMO"} onChange={() => setF({ ...f, dataSource: "SIMULATED_DEMO" })} /><span>Simulated demo data. Reports are labelled as not real field measurements.</span></label>
          <label className="check" style={{ marginTop: 8 }}><input type="radio" name="ds" checked={f.dataSource === "FIELD_DATA"} onChange={() => setF({ ...f, dataSource: "FIELD_DATA" })} /><span>Field data collected with documented farmer consent.</span></label>
        </fieldset>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create programme"}</button>
        </div>
      </form>
    </>
  );
}
