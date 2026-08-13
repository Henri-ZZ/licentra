/**
 * Copies swagger-ui-dist's pre-built UMD bundle + CSS into public/swagger/
 * so the dashboard's API docs page can load them as static assets.
 *
 * Run automatically by `postinstall`. Idempotent — overwrites on each run.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(
  ROOT,
  "node_modules",
  "swagger-ui-dist",
  // pnpm hoists via .pnpm/<name>@<version>/node_modules/swagger-ui-dist/...
  // but a top-level `swagger-ui-dist` symlink is also created for direct imports.
  // Walk up to find the real package if the direct symlink is missing.
);
const OUT = path.join(ROOT, "public", "swagger");

function resolvePackageRoot(): string {
  // Prefer the direct symlink at node_modules/swagger-ui-dist/
  const direct = path.join(ROOT, "node_modules", "swagger-ui-dist");
  if (fs.existsSync(path.join(direct, "package.json"))) return direct;
  // Fallback: scan .pnpm/<name>@<version>/node_modules/<name>/
  const pnpmRoot = path.join(ROOT, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmRoot)) {
    throw new Error(
      "Could not locate swagger-ui-dist. Did `pnpm install` actually run?"
    );
  }
  const matches = fs
    .readdirSync(pnpmRoot)
    .filter((d) => d.startsWith("swagger-ui-dist@"));
  if (matches.length === 0) {
    throw new Error("swagger-ui-dist not found under node_modules/.pnpm/");
  }
  return path.join(pnpmRoot, matches[0], "node_modules", "swagger-ui-dist");
}

function main() {
  const srcRoot = resolvePackageRoot();
  fs.mkdirSync(OUT, { recursive: true });

  const files = ["swagger-ui.css", "swagger-ui-bundle.js"];
  for (const f of files) {
    const from = path.join(srcRoot, f);
    const to = path.join(OUT, f);
    if (!fs.existsSync(from)) {
      throw new Error(`Missing ${from} — is swagger-ui-dist installed correctly?`);
    }
    fs.copyFileSync(from, to);
    console.log(`  copied ${f} → public/swagger/${f}`);
  }

  console.log("Swagger UI assets ready.");
}

main();
