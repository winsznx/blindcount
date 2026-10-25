import { PublicShell } from "@/components/public-shell";
import { Prose } from "@/components/prose";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <PublicShell>
      <Prose title="How BlindCount handles data" lead="This is a prototype. Use fictional data, or field data collected with documented consent. This page is not legal advice.">
        <h2>What goes on a public blockchain</h2>
        <p>Only opaque random keys and salted commitments. Never farm names, counts, photos, criteria, salts or personal data. A commitment can&apos;t be reversed to recover a small count because it includes a 32-byte random salt.</p>
        <h2>What stays private</h2>
        <p>Observations, notes, photos and hidden criteria are stored encrypted on BlindCount servers. Criteria use a separate key. Photos are served only to the uploader, managers and reviewers of the same organization, and every view is logged.</p>
        <h2>Who controls the data</h2>
        <p>The programme operating a cohort owns its data, obtains farmer consent and handles correction or deletion requests. Corrections never erase the original onchain commitment, which identifies no one.</p>
        <h2>Retention</h2>
        <p>Prototype defaults: field evidence and reports 365 days; authentication and security logs 90 days. These are planning defaults, not legally reviewed periods.</p>
        <h2>AI</h2>
        <p>AI evidence checks are off unless a programme opts in. When on, only photos are sent, without the criterion, outcome or count, and results are suggestions for a human reviewer.</p>
      </Prose>
    </PublicShell>
  );
}
