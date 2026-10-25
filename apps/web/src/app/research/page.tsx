import { PublicShell } from "@/components/public-shell";
import { Prose } from "@/components/prose";
import results from "../../../../../data/research/results.json";
import styles from "./research.module.css";

export const metadata = { title: "Research context" };

const pct = (x: number) => `${(x * 100).toFixed(1)}`;

export default function Research() {
  const seed = results.by_tree_type.seedlings;
  const shown = seed.Information;
  const hidden = seed["No Information"];
  const max = Math.max(shown.excess_rate, hidden.excess_rate);
  const [shownLo = 0, shownHi = 0] = shown.excess_95ci_normal;
  const [hiddenLo = 0, hiddenHi = 0] = hidden.excess_95ci_normal;
  return (
    <PublicShell>
      <Prose title="The evidence behind concealment" lead="A randomized field study in Côte d'Ivoire found that verifiers who could see the pass threshold adjusted their counts far more often. We reproduced its headline result from the public data.">
        <figure className={styles.figure} aria-labelledby="fig-caption">
          <div className={styles.bars}>
            <div className={styles.barRow}>
              <span className={styles.barLabel}>Threshold shown</span>
              <span className={styles.track}><span className={styles.fillShown} style={{ width: `${(shown.excess_rate / max) * 100}%` }} /></span>
              <strong className={styles.value}>{pct(shown.excess_rate)} pts</strong>
            </div>
            <div className={styles.barRow}>
              <span className={styles.barLabel}>Threshold concealed</span>
              <span className={styles.track}><span className={styles.fillHidden} style={{ width: `${(hidden.excess_rate / max) * 100}%` }} /></span>
              <strong className={styles.value}>{pct(hidden.excess_rate)} pts</strong>
            </div>
          </div>
          <figcaption id="fig-caption" className="muted">
            Extra share of shade-tree (seedling) counts that were amended when a farm failed its first verification visit, compared with farms that passed. {results.farms} farms;{" "}
            {results.arms.Information} verifications with the threshold shown, {results.arms["No Information"]} with it concealed. 95% intervals: {pct(shownLo)}–{pct(shownHi)} and {pct(hiddenLo)}–{pct(hiddenHi)} points.
          </figcaption>
        </figure>

        <h2>The study</h2>
        <p>
          Federico Cammelli, Johan Six and Rachael Garrett, <em>False reporting undermines the integrity of supply chain sustainability initiatives</em>. Data and code on Dryad, published 4 August 2026 under CC0:{" "}
          <a href="https://doi.org/10.5061/dryad.v9s4mw77q" target="_blank" rel="noreferrer">doi.org/10.5061/dryad.v9s4mw77q</a>.
        </p>
        <p>
          The authors report manipulation in about 25% of field verification reports, and about 11% when the compliance criteria were concealed from verifiers. An{" "}
          <a href="https://ethz.ch/en/news-and-events/eth-news/news/2026/08/study-reveals-weaknesses-in-farm-sustainability-monitoring.html" target="_blank" rel="noreferrer">ETH Zurich article</a> describes the 407 cocoa farms in the study.
        </p>

        <h2>How we reproduced it</h2>
        <p>
          <span className="mono">data/research/reproduce.py</span> downloads the public dataset, checks the CSV against a pinned SHA-256, and computes, for each arm, the share of forms whose seedling count was amended when the first visit failed minus the share when it passed. That is the same contrast the authors&apos; Stata script computes from a saturated logit. It gives {pct(shown.excess_rate)} points with the threshold shown and {pct(hidden.excess_rate)} with it concealed, matching the published figures.
        </p>

        <h2>What BlindCount builds on it</h2>
        <p>The intervention is a workflow: record the observation before the person counting can compare it with the number that decides the outcome. BlindCount enforces that in software and in a smart contract, with the reveal held back for the whole cohort so one finished audit can&apos;t leak the target for the rest. It then makes the first count tamper-evident, so it can&apos;t be quietly adjusted afterwards either.</p>

        <h2>Scope</h2>
        <ul>
          <li>The farms in this study are the authors&apos;. BlindCount&apos;s demo uses clearly labelled simulated farms; a BlindCount field pilot is the next step.</li>
          <li>The published data is tabular, so no evidence photo in this product comes from the study.</li>
          <li>BlindCount improves the reliability of the records behind shade-tree claims; it doesn&apos;t convert counts into carbon tonnes, which needs a validated methodology.</li>
        </ul>
      </Prose>
    </PublicShell>
  );
}
