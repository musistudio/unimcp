import { chmod } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node"
  }
});

await chmod("dist/index.js", 0o755);
