import { build } from "esbuild";
import path from "node:path";

const root = process.cwd();

// Redirect the Firebase Admin module to the in-memory fake so the real
// handlers can be driven without credentials.
const stubFirebase = {
  name: "stub-firebase-admin",
  setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$/ }, () => ({
      path: path.join(root, "tests", "workflow", "fakeAdmin.ts"),
    }));
  },
};

await build({
  entryPoints: ["tests/workflow/flow.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "tests/workflow/flow.mjs",
  plugins: [stubFirebase],
  logLevel: "error",
});
console.log("bundled tests/workflow/flow.mjs");
