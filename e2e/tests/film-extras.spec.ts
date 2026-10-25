import { test } from "@playwright/test";

// Extra stills for the demo film; runs only when SHOTS_DIR is set.
const SHOTS = process.env.SHOTS_DIR;
test.skip(!SHOTS, "film stills only");
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

test("film stills: landing, research, verifier", async ({ page }) => {
  for (const [name, path] of [["x-landing", "/"], ["x-research", "/research"], ["x-verify", "/verify"]] as const) {
    await page.goto(path);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
});

test("film stills: contract on Etherscan", async ({ page }) => {
  await page.goto("https://sepolia.etherscan.io/address/0x4f38eabf65725d38b4c04410c04318869ae3e8e1#code", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}/x-etherscan.png` });
});
