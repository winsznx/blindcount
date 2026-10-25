import { ExternalLink } from "lucide-react";
import { shortHash } from "@/lib/format";

export function TxLink({ hash, explorer }: { hash: string | null | undefined; explorer: string | null | undefined }) {
  if (!hash) return <span className="subtle">—</span>;
  if (!explorer) return <span className="mono" title={hash}>{shortHash(hash)}</span>;
  return (
    <a className="mono" href={`${explorer.replace(/\/$/, "")}/tx/${hash}`} target="_blank" rel="noreferrer" title={hash} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {shortHash(hash)} <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}
