import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { Prose } from "@/components/prose";

export const metadata = { title: "Live demo" };

const SCENARIOS = [
  { title: "Clean report", body: "A manager sets a shared hidden criterion and two assignments. Two demo auditors record counts and finalize. Both submissions are signed and anchored. The manager closes the cohort, the custodian discloses, a reviewer approves, and the packet verifies." },
  { title: "Tamper attempt", body: "Change the count inside a copy of the exported ZIP. The verifier reports integrity failed and names the exact file and commitment that no longer match. The onchain original still verifies." },
  { title: "Incomplete cohort", body: "With one assignment still open, closing the cohort is refused and the blocker is named without revealing the criterion. Once the second visit seals, closure proceeds." },
];

export default function Demo() {
  return (
    <PublicShell>
      <Prose title="Live demo" lead="A real app, real signatures and real testnet transactions. The farms, auditors and counts are simulated and labelled as such.">
        <ol style={{ paddingLeft: 20, display: "grid", gap: 16 }}>
          {SCENARIOS.map((s) => (
            <li key={s.title}><strong>{s.title}.</strong> <span className="muted">{s.body}</span></li>
          ))}
        </ol>
        <h2>Run it yourself</h2>
        <p className="muted">Sign in with the demo identities created by <span className="mono">pnpm seed:demo</span>, or create your own organization and invite three email addresses you control. Sign-in codes are delivered by email; in local development they are written to <span className="mono">storage/outbox.log</span>.</p>
        <div className="row">
          <Link className="btn btn-primary btn-lg" href="/sign-in">Sign in</Link>
          <Link className="btn btn-secondary btn-lg" href="/verify">Verify a packet</Link>
        </div>
      </Prose>
    </PublicShell>
  );
}
