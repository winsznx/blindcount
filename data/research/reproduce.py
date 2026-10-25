"""Reproduce the headline figures of Cammelli, Six & Garrett (2026) from their public Dryad dataset.

Standard library only. Downloads the CC0 dataset version, checks the CSV's SHA-256, and recomputes the
excess rate of amended shade-tree counts on farms that failed the first verification visit, separately
for verifiers who were shown the compliance threshold ("Information") and those who were not.

Run: python3 -I data/research/reproduce.py            (writes data/research/results.json)
"""
import csv
import hashlib
import io
import json
import math
import pathlib
import urllib.request
import zipfile

VERSION_ZIP = "https://datadryad.org/api/v2/versions/456223/download"
CSV_NAME = "cheating_wide_anonymised_v2.csv"
CSV_SHA256 = "c07dce34ff0467142cdd449db5eeb67703e662ae2c941d6360f8323b222f564a"
HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / "source" / CSV_NAME

TREES = {"seedlings": "changed_p", "wildlings": "changed_s", "naturally_occurring": "changed_n"}


def load_rows():
    if not CACHE.exists():
        with urllib.request.urlopen(VERSION_ZIP, timeout=60) as resp:
            archive = zipfile.ZipFile(io.BytesIO(resp.read()))
        data = archive.read(CSV_NAME)
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_bytes(data)
    data = CACHE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != CSV_SHA256:
        raise SystemExit(f"dataset digest {digest} does not match the pinned {CSV_SHA256}")
    return list(csv.DictReader(io.StringIO(data.decode("utf-8"))))


def proportion(rows, column):
    valid = [r for r in rows if r[column].strip() != ""]
    hits = sum(1 for r in valid if r[column].strip() == "1")
    return hits, len(valid)


def excess(rows, column, arm):
    """Amendment rate when the first visit failed minus the rate when it passed, within one arm."""
    fail = [r for r in rows if r["treatment"] == arm and r["winner_0"] == "Not pass"]
    pas = [r for r in rows if r["treatment"] == arm and r["winner_0"] == "Pass"]
    (kf, nf), (kp, np_) = proportion(fail, column), proportion(pas, column)
    pf, pp = kf / nf, kp / np_
    se = math.sqrt(pf * (1 - pf) / nf + pp * (1 - pp) / np_)
    d = pf - pp
    return {
        "failed_first_visit": {"amended": kf, "n": nf, "rate": round(pf, 4)},
        "passed_first_visit": {"amended": kp, "n": np_, "rate": round(pp, 4)},
        "excess_rate": round(d, 4),
        "excess_95ci_normal": [round(d - 1.96 * se, 4), round(d + 1.96 * se, 4)],
    }


def main():
    rows = load_rows()
    result = {
        "source": "Cammelli, Six & Garrett (2026), Dryad doi:10.5061/dryad.v9s4mw77q, CC0-1.0",
        "csv_sha256": CSV_SHA256,
        "farms": len(rows),
        "arms": {arm: sum(1 for r in rows if r["treatment"] == arm) for arm in ("Information", "No Information")},
        "method": "Share of verification forms whose count was amended, first-visit fail minus first-visit pass, per arm. "
        "Equals the authors' contrast of margins from a saturated logit (collusion_analysis_v3.do).",
        "by_tree_type": {
            tree: {arm: excess(rows, col, arm) for arm in ("Information", "No Information")} for tree, col in TREES.items()
        },
    }
    out = HERE / "results.json"
    out.write_text(json.dumps(result, indent=2) + "\n")
    s = result["by_tree_type"]["seedlings"]
    print(f"{result['farms']} farms. Seedlings excess amendment rate: threshold shown "
          f"{100 * s['Information']['excess_rate']:.1f} pts, threshold concealed {100 * s['No Information']['excess_rate']:.1f} pts.")
    print(f"wrote {out.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
