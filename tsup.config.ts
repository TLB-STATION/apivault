import { defineConfig } from "tsup";

export default defineConfig({
  // Map output path -> source so the bundle is emitted as dist/cli.js
  // (keeps package.json "bin": "dist/cli.js" stable).
  entry: { cli: "src/index.ts" },
  format: ["cjs"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  banner: { js: "#!/usr/bin/env node" },
});
