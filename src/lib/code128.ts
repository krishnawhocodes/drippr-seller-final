// src/lib/code128.ts
//
// Code 128 (subset B) encoder, for the barcode on a DRIPPR shipping label.
//
// A label whose barcode does not scan is worse than one with no barcode at
// all: the parcel reaches the counter, fails, and is handled by hand anyway
// while someone works out why. So the symbol table is checked against the
// format's own invariant at module load - every Code 128 symbol is exactly 11
// modules wide, and the stop pattern is 13 - and `encode` refuses to return a
// symbol it could not build.

/**
 * Bar/space run lengths for values 0-106. Each digit is a run of modules,
 * alternating bar, space, bar, space, bar, space.
 */
const PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131",
  "211412", // 103 START A
  "211214", // 104 START B
  "211232", // 105 START C
  "2331112", // 106 STOP
];

const START_B = 104;
const STOP = 106;

/** True when the table matches Code 128's own module-width invariant. */
export function patternTableIsValid(): boolean {
  if (PATTERNS.length !== 107) return false;
  return PATTERNS.every((pattern, value) => {
    const expected = value === STOP ? 13 : 11;
    const elements = value === STOP ? 7 : 6;
    if (pattern.length !== elements) return false;
    let sum = 0;
    for (const ch of pattern) {
      const n = Number(ch);
      if (!Number.isInteger(n) || n < 1 || n > 4) return false;
      sum += n;
    }
    return sum === expected;
  });
}

const TABLE_OK = patternTableIsValid();

/** Subset B covers ASCII 32-126, which is everything a label needs. */
export function canEncode(text: string): boolean {
  return (
    TABLE_OK &&
    text.length > 0 &&
    [...text].every((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
  );
}

export type Code128Bar = {
  /** Distance from the symbol's start, in modules. */
  start: number;
  /** Width in modules. */
  width: number;
};

export type Code128Symbol = {
  bars: Code128Bar[];
  /** Total symbol width in modules, including the quiet zones. */
  modules: number;
  /** Quiet zone each side, in modules. Code 128 requires at least 10. */
  quietZone: number;
};

/**
 * Builds the bars for `text`, or null when it cannot be encoded.
 *
 * Returning null rather than a partial symbol is deliberate: the caller
 * prints the text on its own instead of a barcode that would not scan.
 */
export function encode(text: string): Code128Symbol | null {
  if (!canEncode(text)) return null;

  const values: number[] = [START_B];
  for (const ch of text) values.push(ch.charCodeAt(0) - 32);

  // Checksum: start value plus each payload value times its position.
  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) checksum += values[i] * i;
  values.push(checksum % 103);
  values.push(STOP);

  const quietZone = 10;
  const bars: Code128Bar[] = [];
  let cursor = quietZone;

  for (const value of values) {
    const pattern = PATTERNS[value];
    if (!pattern) return null;
    let isBar = true;
    for (const ch of pattern) {
      const width = Number(ch);
      if (isBar) bars.push({ start: cursor, width });
      cursor += width;
      isBar = !isBar;
    }
  }

  return { bars, modules: cursor + quietZone, quietZone };
}
