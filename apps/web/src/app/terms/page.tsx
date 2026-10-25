import { PublicShell } from "@/components/public-shell";
import { Prose } from "@/components/prose";

export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <PublicShell>
      <Prose title="Terms and prototype disclosure">
        <p>BlindCount is a prototype built for the IEEE ClimateChain Global Hackathon 2026. It runs on an EVM testnet and is provided as is, without warranty.</p>
        <p>A verified packet shows that a record matches what was submitted and anchored. It does not certify that a field count is true, that a farm complies with any regulation, or that any party acted honestly. BlindCount issues no certification and no carbon or ecological claims.</p>
        <p>Don&apos;t upload personal data without the data subject&apos;s informed consent and a lawful basis under the rules that apply to your programme.</p>
        <p>BlindCount is a working name and not a trademark claim.</p>
      </Prose>
    </PublicShell>
  );
}
