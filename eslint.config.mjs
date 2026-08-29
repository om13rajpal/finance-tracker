import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next (14.x) still ships an .eslintrc-style config rather than
// a native flat config, so it is loaded through FlatCompat and then scoped
// down to the web/ package below.
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

// Route/middleware/error-handling files where `(req as any).userId` /
// `(err as any).status` is an established, already-reviewed pattern (chosen
// during the auth task in place of a global Express Request type
// augmentation). `no-explicit-any` is relaxed only for these specific files
// so the rule still catches stray `any` usage everywhere else in the API.
const apiExplicitAnyAllowedFiles = [
  "api/src/**/*.routes.ts",
  "api/src/modules/auth/auth.middleware.ts",
  "api/src/modules/auth/auth.service.ts",
  "api/src/lib/errorHandler.ts",
  "api/src/modules/tax/tax-slab.service.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/._*",
      "**/playwright-report/**",
      "**/test-results/**",
      "pnpm-lock.yaml",
      // Not part of this project: Claude Code's own bundled tooling/skills, git
      // worktree checkouts, and Playwright MCP's scratch dir. These happen to live
      // in the repo working directory but aren't code this project owns or ships.
      ".claude/**",
      ".worktrees/**",
      ".playwright-mcp/**",
    ],
  },

  // Baseline JS + TypeScript rules across the whole monorepo (api, web, shared).
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // api package (Node / Express).
  {
    files: ["api/src/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: apiExplicitAnyAllowedFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // web package (Next.js) — Next's own recommended rules, scoped to web/.
  ...compat.extends("next/core-web-vitals").map((config) => ({
    ...config,
    files: ["web/**/*.ts", "web/**/*.tsx", "web/**/*.js", "web/**/*.jsx"],
  })),
  {
    files: ["web/**/*.ts", "web/**/*.tsx"],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Must be last: turns off any ESLint stylistic rules that would fight
  // Prettier's formatting output.
  eslintConfigPrettier
);
