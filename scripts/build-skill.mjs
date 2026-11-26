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
// --prices-url  optional: written to the skill's config.json so it fetches
//               fresh prices when the sandbox has network access.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(ROOT, "skill", "gilt-ladder");
const ENGINE_FILES = ["giltMath.js", "ukTax.js", "giltUniverse.js", "ladderEngine.js"];

export function buildSkill({ pricesUrl = null, zip = true } = {}) {
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

  const cfgPath = join(SKILL, "config.json");
  if (pricesUrl) fs.writeFileSync(cfgPath, JSON.stringify({ pricesUrl }, null, 2) + "\n");
  else if (!fs.existsSync(cfgPath)) fs.writeFileSync(cfgPath, JSON.stringify({ pricesUrl: null }, null, 2) + "\n");

  let zipPath = null;
  if (zip) {
    const out = join(ROOT, "dist-skill");
    fs.mkdirSync(out, { recursive: true });
    zipPath = join(out, "gilt-ladder.zip");
    fs.rmSync(zipPath, { force: true });
    execFileSync("zip", ["-qr", zipPath, "gilt-ladder", "-x", "*.DS_Store"], { cwd: join(ROOT, "skill") });
  }
  return { commit, pricesAsOf: prices.asOf, zipPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--prices-url");
  const r = buildSkill({ pricesUrl: i > 0 ? process.argv[i + 1] : null });
  console.log(`Built skill: engine ${r.commit}, prices as of ${r.pricesAsOf}${r.zipPath ? ` → ${r.zipPath}` : ""}`);
}
