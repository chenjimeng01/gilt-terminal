// Build the "gilt-ladder" Claude Skill from this repository.
//
//   npm run build:skill [-- --prices-url https://your-site/gilt-prices.json]
//
// Copies the calculator engine (the same files the website runs) and the
// current price file into skill/gilt-ladder, writes a VERSION file, and zips
// the folder to dist-skill/gilt-ladder.zip for upload to Claude
// (Settings → Capabilities → Skills). The copied files are build output and
// are not committed, so the skill can never drift from the tested engine.
//
// --prices-url  where the skill fetches current prices (default: the live
//               site, DEFAULT_PRICES_URL); "none" to use only the bundled file.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(ROOT, "skill", "gilt-ladder");
const ENGINE_FILES = ["giltMath.js", "ukTax.js", "giltUniverse.js", "ladderEngine.js"];
// The live site's price file (public, refreshed each weekday). The skill tries
// it first and falls back to the bundled copy.
export const DEFAULT_PRICES_URL = "https://gilt-terminal.vercel.app/gilt-prices.json";

export function buildSkill({ pricesUrl = DEFAULT_PRICES_URL, zip = true } = {}) {
  const engineDir = join(SKILL, "scripts", "engine");
  const dataDir = join(SKILL, "data");
  fs.rmSync(engineDir, { recursive: true, force: true });
  fs.mkdirSync(engineDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  for (const f of ENGINE_FILES) {
    const src = fs.readFileSync(join(ROOT, "src", f), "utf8");
    // Fail loudly if the engine grows a dependency the skill doesn't carry.
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)) {
      const dep = m[1].replace(/^\.\//, "");
      if (!ENGINE_FILES.includes(dep)) throw new Error(`src/${f} imports "${m[1]}", which the skill does not include.`);
    }
    fs.writeFileSync(join(engineDir, f), `// Copied from src/${f} by scripts/build-skill.mjs — do not edit here.\n${src}`);
  }

  const prices = JSON.parse(fs.readFileSync(join(ROOT, "public", "gilt-prices.json"), "utf8"));
  fs.writeFileSync(join(dataDir, "gilt-prices.json"), JSON.stringify(prices, null, 2) + "\n");

  let commit = "unknown";
  try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim(); } catch { /* not a git checkout */ }
  fs.writeFileSync(join(SKILL, "VERSION"), `engine ${commit}\nprices as of ${prices.asOf}\nbuilt ${new Date().toISOString()}\n`);

  const url = pricesUrl && pricesUrl !== "none" ? pricesUrl : null;
  fs.writeFileSync(join(SKILL, "config.json"), JSON.stringify({ pricesUrl: url }, null, 2) + "\n");

  let zipPath = null;
  if (zip) {
    const out = join(ROOT, "dist-skill");
    fs.mkdirSync(out, { recursive: true });
    zipPath = join(out, "gilt-ladder.zip");
    fs.rmSync(zipPath, { force: true });
    execFileSync("zip", ["-qr", zipPath, "gilt-ladder", "-x", "*.DS_Store"], { cwd: join(ROOT, "skill") });
  }
  return { commit, pricesAsOf: prices.asOf, pricesUrl: url, zipPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--prices-url");
  const r = buildSkill(i > 0 ? { pricesUrl: process.argv[i + 1] } : {});
  console.log(`Built skill: engine ${r.commit}, bundled prices as of ${r.pricesAsOf}, live prices from ${r.pricesUrl ?? "(none)"}${r.zipPath ? ` → ${r.zipPath}` : ""}`);
}
