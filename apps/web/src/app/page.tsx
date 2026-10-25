import Link from "next/link";
import { Camera, Lock, ShieldCheck } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import styles from "./home.module.css";

const STEPS = [
  { title: "Count", body: "The auditor records what they observe on a phone. The pass threshold is never sent to their device." },
  { title: "Seal", body: "The device signs the first submission. A salted commitment is anchored on an EVM testnet, so the original can't be quietly rewritten." },
  { title: "Close", body: "Only when every assignment in the cohort is sealed or voided does the registry allow closure, and only then is the target disclosed." },
  { title: "Verify", body: "A buyer or verifier checks the proof packet against the chain themselves, without a BlindCount account." },
];

export default function Home() {
  return (
    <PublicShell>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Research-backed workflow. Prototype system. Simulated farm scenarios. Real testnet verification.</p>
          <h1 className={styles.headline}>
            Count first.
            <br />
            Compare later.
          </h1>
          <p className={styles.sub}>Field inspections that conceal the pass threshold, preserve the original result and give buyers a record they can independently verify.</p>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/demo" className="btn btn-primary btn-lg">
              View live demo
            </Link>
            <Link href="/verify" className="btn btn-secondary btn-lg">
              Verify a report
            </Link>
          </div>
          <p className={styles.trust}>Sealed records prove what was submitted. They do not prove a count was true.</p>
        </div>

        <figure className={styles.device} aria-label="Illustration of the auditor's field form">
          <div className={styles.phone}>
            <div className={styles.phoneTop}>
              <span className={styles.farm}>FARM-014</span>
              <span className="status status-active">Offline-capable</span>
            </div>
            <p className={styles.hint}>Count what you observe. The programme target is intentionally hidden.</p>
            <div className={styles.countDisplay}>
              <span className="num">12</span>
              <small>shade trees</small>
            </div>
            <span className="sealed-slot">
              <Lock aria-hidden="true" /> Target sealed until cohort closes
            </span>
            <div className={styles.photoRow}>
              <span>
                <Camera size={15} aria-hidden="true" /> 1 photo · sha256 3f9a…c21e
              </span>
            </div>
            <div className="btn btn-primary btn-block" aria-hidden="true">
              Review and finalize
            </div>
          </div>
          <figcaption className="subtle">Illustration of the auditor view. No score meter, no hint of the target.</figcaption>
        </figure>
      </section>

      <section id="how" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>One cohort, four irreversible steps</h2>
          <p className="muted">Revealing a shared threshold after the first audit would compromise every remaining one. So the reveal unit is the whole cohort, enforced by the server and by the registry contract.</p>
        </div>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className={styles.stepNum}>{i + 1}</span>
              <h3>{s.title}</h3>
              <p className="muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <div className={styles.split}>
          <div className="stack">
            <h2>Why conceal the number</h2>
            <p className="muted">
              A 2026 randomized study of 407 cocoa farms in Côte d&apos;Ivoire found that verifiers who could see the pass threshold amended failing counts far more often: about 25% excess manipulation, against about 11% when the threshold was concealed. We
              reproduced both figures from the authors&apos; public data. BlindCount turns that intervention into enforced software.
            </p>
            <Link href="/research">See the reproduction</Link>
          </div>
          <dl className={styles.limits}>
            <div>
              <dt>
                <ShieldCheck size={16} aria-hidden="true" /> What a sealed record proves
              </dt>
              <dd>The exact payload, device signature and receipt time existed before the criterion was disclosed, and nobody has changed them since.</dd>
            </div>
            <div>
              <dt>
                <Lock size={16} aria-hidden="true" /> What it cannot prove
              </dt>
              <dd>That the count is true, that a photo shows this farm, or that people did not collude outside the app. Reviewers still decide.</dd>
            </div>
          </dl>
        </div>
      </section>
    </PublicShell>
  );
}
