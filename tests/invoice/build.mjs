import { build } from "esbuild";

// src/lib/invoiceTax.ts is plain TypeScript with no browser dependencies, so
// it bundles straight to a runnable script without any stubbing.
await build({
  entryPoints: ["tests/invoice/totals.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "tests/invoice/totals.mjs",
  logLevel: "error",
});
console.log("bundled tests/invoice/totals.mjs");
