import { PublicShell } from "@/components/public-shell";
import { Verifier } from "./verifier";

export const metadata = { title: "Verify a packet" };

export default function VerifyPage() {
  return (
    <PublicShell>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 16px 0" }} className="stack-lg">
        <div className="stack-sm">
          <h1>Verify a proof packet</h1>
          <p className="muted" style={{ maxWidth: 640 }}>Drop a BlindCount proof ZIP. Every check runs in this browser and reads the registry through the RPC you choose. The packet is never uploaded to BlindCount.</p>
        </div>
        <Verifier />
      </div>
    </PublicShell>
  );
}
