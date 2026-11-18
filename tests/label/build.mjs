import { build } from "esbuild";

await build({
  entryPoints: ["tests/label/code128.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "tests/label/code128.mjs",
  logLevel: "error",
});
console.log("bundled tests/label/code128.mjs");
