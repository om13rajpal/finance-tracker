// Copies the brand kit's tokens.css into web/app/ so Next can import it as a
// normal local stylesheet. The brand kit is the SOURCE OF TRUTH: never edit
// web/app/tokens.css by hand; edit docs/design/brand-kit/tokens.css and re-run:
//
//   pnpm --filter web sync:tokens
//
// Runs automatically before `dev` and `build`.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../docs/design/brand-kit/tokens.css");
const dest = resolve(here, "../app/tokens.css");

const banner = `/* ─────────────────────────────────────────────────────────────────────
   GENERATED FILE. DO NOT EDIT.
   Source: docs/design/brand-kit/tokens.css
   Regenerate: pnpm --filter web sync:tokens
   ───────────────────────────────────────────────────────────────────── */\n\n`;

writeFileSync(dest, banner + readFileSync(src, "utf8"));
console.log(`sync-tokens: ${src} -> ${dest}`);
