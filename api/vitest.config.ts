import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    hookTimeout: 60000,
    // This external volume generates AppleDouble sidecar files (e.g. "._foo.test.ts")
    // for every file, matched by vitest's default test glob and run as spurious
    // failures (they're binary, not JS). Excluded here on top of the defaults rather
    // than replacing them, so node_modules/dist/etc. stay excluded too.
    exclude: [...configDefaults.exclude, "**/._*"],
  },
});
