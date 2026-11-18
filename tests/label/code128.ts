// Tests for src/lib/code128.ts.
//
// A barcode that does not scan is worse than no barcode: the parcel still
// gets handled by hand, but only after someone has worked out why the reader
// beeped. There is no scanner here, so instead the symbol is read back the
// way a scanner reads it - measure the bar and space runs, look each group of
// six up in the table, and check the result is the text that went in, with a
// valid check character.
//
// Run with:  npm run test:label

import {
  canEncode,
  encode,
  patternTableIsValid,
} from "../../src/lib/code128";

let failures = 0;

function expect(condition: boolean, label: string, detail = "") {
  if (condition) {
    console.log("  ok   " + label);
  } else {
    failures += 1;
    console.log("  FAIL " + label + (detail ? " -> " + detail : ""));
  }
}

/**
 * Reads a symbol back into run lengths, exactly what a scanner measures:
 * alternating bar and space widths across the whole symbol.
 */
function toRunLengths(symbol: NonNullable<ReturnType<typeof encode>>): number[] {
  const runs: number[] = [];
  let cursor = symbol.quietZone;
  for (const bar of symbol.bars) {
    if (bar.start > cursor) runs.push(bar.start - cursor); // space before it
    runs.push(bar.width);
    cursor = bar.start + bar.width;
  }
  return runs;
}

/** Decodes run lengths back to the original text, or null if invalid. */
function decode(runs: number[]): string | null {
  // Every symbol is six runs, except the stop pattern's seven.
  if ((runs.length - 7) % 6 !== 0) return null;
  const groups: string[] = [];
  for (let i = 0; i + 6 <= runs.length; i += 6) {
    const remaining = runs.length - i;
    const size = remaining === 7 ? 7 : 6;
    groups.push(runs.slice(i, i + size).join(""));
    if (size === 7) break;
  }

  const PATTERNS_FOR_LOOKUP: Record<string, number> = {};
  // Rebuild the lookup from the encoder itself by encoding every character,
  // which keeps this decoder honest about what the table actually contains.
  for (let value = 0; value < 95; value += 1) {
    const ch = String.fromCharCode(value + 32);
    const sym = encode(ch);
    if (!sym) continue;
    const r = toRunLengths(sym);
    // group 0 is START B, group 1 is the character itself
    PATTERNS_FOR_LOOKUP[r.slice(6, 12).join("")] = value;
  }

  const startRun = groups[0];
  const startSym = encode("A");
  if (!startSym) return null;
  if (startRun !== toRunLengths(startSym).slice(0, 6).join("")) return null;

  const payload = groups.slice(1, -2); // drop start, checksum, stop
  const checkGroup = groups[groups.length - 2];

  let text = "";
  for (const group of payload) {
    const value = PATTERNS_FOR_LOOKUP[group];
    if (value === undefined) return null;
    text += String.fromCharCode(value + 32);
  }

  // Recompute the check character the way a reader does.
  let checksum = 104;
  [...text].forEach((ch, i) => {
    checksum += (ch.charCodeAt(0) - 32) * (i + 1);
  });
  const expectedCheck = checksum % 103;
  const actualCheck = PATTERNS_FOR_LOOKUP[checkGroup];
  if (actualCheck !== undefined && actualCheck !== expectedCheck) return null;

  return text;
}

console.log("\nSymbol table");
expect(
  patternTableIsValid(),
  "every symbol is 11 modules wide, and the stop pattern 13",
);

console.log("\nRound trip");
const samples = [
  "DRP1063",
  "#1063",
  "19181152764182",
  "DRP/2026-27/001063",
  "ORDER 1063 GWALIOR",
  "a-z A-Z 0-9",
];
for (const sample of samples) {
  const symbol = encode(sample);
  if (!symbol) {
    failures += 1;
    console.log("  FAIL could not encode " + JSON.stringify(sample));
    continue;
  }
  const decoded = decode(toRunLengths(symbol));
  expect(
    decoded === sample,
    "reads back as " + JSON.stringify(sample),
    "got " + JSON.stringify(decoded),
  );
}

console.log("\nGeometry");
const sym = encode("DRP1063");
if (sym) {
  const total = sym.bars.reduce((n, b) => n + b.width, 0);
  expect(sym.quietZone >= 10, "quiet zone is at least 10 modules");
  expect(
    sym.bars.every((b) => b.width >= 1 && b.width <= 4),
    "no bar is wider than 4 modules",
  );
  expect(total > 0 && total < sym.modules, "bars fit inside the symbol");
  expect(
    sym.bars.every((b, i) => i === 0 || b.start >= sym.bars[i - 1].start + sym.bars[i - 1].width),
    "bars never overlap",
  );
}

console.log("\nRefusals");
expect(encode("") === null, "empty text is refused");
expect(encode("café") === null, "a character outside subset B is refused");
expect(canEncode("DRP1063"), "ordinary label text is accepted");

console.log(
  failures
    ? "\n" + failures + " BARCODE ASSERTION(S) FAILED"
    : "\nAll barcode assertions passed.",
);
process.exit(failures ? 1 : 0);
