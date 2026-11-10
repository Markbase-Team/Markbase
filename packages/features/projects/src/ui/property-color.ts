// Distinct, readable badge/control styles for property *values*. Each pairs a
// light background with a strong (…-800) foreground so the text stays legible
// (the old …-700 on …-100 read as low-contrast). Greens are intentionally
// omitted so values never clash with the lime brand accent or look green-on-green.
const VALUE_PALETTE = [
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200",
  "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
];

// Distinct colors for the built-in Priority values, so urgency reads at a
// glance: High stands out (red), Medium is amber, Low is calm slate.
export const PRIORITY_VALUE_COLORS: Record<string, string> = {
  High: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  Medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  Low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

// A distinct color for one value of a property. Prefer the value's position
// among the property's options so each value in a property is visually
// separated and stable; fall back to hashing the text when the index is unknown.
export function propertyValueColor(value: string, index: number): string {
  let i = index;
  if (i < 0) {
    let hash = 0;
    for (let c = 0; c < value.length; c++) {
      hash = (hash * 31 + value.charCodeAt(c)) | 0;
    }
    i = Math.abs(hash);
  }
  return VALUE_PALETTE[i % VALUE_PALETTE.length];
}
