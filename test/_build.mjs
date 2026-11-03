import { execSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const SRC = join(fileURLToPath(new URL("../src", import.meta.url)));

/**
 * Load a module from src/ into a check.
 *
 * Transpiled with esbuild rather than copied, so a check can never drift from
 * what actually ships — the failure mode where a test keeps passing against a
 * stale copy of the logic is the one worth designing out.
 *
 * Paths resolve from this file, so the checks run from any clone.
 */
export async function loadFromSrc(relativePath, { bundle = false } = {}) {
  const entry = join(SRC, relativePath);
  const out = join(mkdtempSync(join(tmpdir(), "dai-check-")), basename(relativePath, ".ts") + ".mjs");
  execSync(
    `npx --yes esbuild@0.25.0 ${JSON.stringify(entry)} --format=esm --platform=node ` +
      `--target=node20 ${bundle ? "--bundle" : ""} --outfile=${JSON.stringify(out)} --log-level=error`,
    { stdio: "inherit" },
  );
  // A file URL, not a bare path: on Windows `import("C:\\…")` reads `C:` as a
  // URL scheme and dies with ERR_UNSUPPORTED_ESM_URL_SCHEME.
  return import(pathToFileURL(out).href);
}

/** Minimal check harness shared by the suites. */
export function harness() {
  let pass = 0;
  const failures = [];
  return {
    check(name, ok, detail = "") {
      if (ok) {
        pass++;
        console.log(`  ✓ ${name}`);
      } else {
        failures.push(`${name} — ${detail}`);
        console.log(`  ✗ ${name}  ${detail}`);
      }
    },
    report() {
      console.log(`\n${pass} passed, ${failures.length} failed`);
      if (failures.length) {
        console.log("\nFAILURES");
        for (const f of failures) console.log("  •", f);
      }
      process.exit(failures.length ? 1 : 0);
    },
  };
}
