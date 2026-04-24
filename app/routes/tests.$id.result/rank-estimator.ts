// ── Rank estimator — Gaussian model fitted from JEE Advanced 2012–2025 ────────

const JEE_ADV_SLOPE      = 22.45;
const JEE_ADV_INTERCEPT  =  1.62;
const JEE_ADV_CANDIDATES = 165000;

const JEE_MAIN_SLOPE     = -26.02;
const JEE_MAIN_INTERCEPT =  -2.13;

export function normCDF(z: number): number {
  const sign = z >= 0 ? 1 : -1;
  z = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422820 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return sign === 1 ? 1 - p : p;
}

export function computeRank(scorePct: number, diff: number): number {
  const diffMult     = 0.85 + 0.15 * (diff / 10);
  const effectivePct = scorePct * diffMult;
  const z            = (effectivePct - JEE_ADV_INTERCEPT) / JEE_ADV_SLOPE;
  return Math.max(1, Math.round((1 - normCDF(z)) * JEE_ADV_CANDIDATES));
}

export function computePercentile(scorePct: number): number {
  const z = (scorePct - JEE_MAIN_INTERCEPT) / JEE_MAIN_SLOPE;
  const percentile = 100 * (1 - normCDF(z));
  return Math.max(0, Math.min(100, percentile));
}

export function percentileBand(percentile: number): { label: string; colour: string } {
  if (percentile >= 99.5) return { label: "99.5+ — Elite",        colour: "#f59e0b" };
  if (percentile >= 99)   return { label: "99+ — Outstanding",    colour: "#10b981" };
  if (percentile >= 97)   return { label: "97+ — Excellent",      colour: "var(--c-success)" };
  if (percentile >= 90)   return { label: "90+ — Strong",         colour: "var(--c-brand-500)" };
  if (percentile >= 75)   return { label: "75+ — Good",           colour: "var(--c-brand-400)" };
  return                         { label: "Keep practising",       colour: "var(--c-text-3)" };
}

export function rankBand(rank: number): { label: string; colour: string } {
  if (rank <= 500)   return { label: "Top 0.3% — Elite",        colour: "#f59e0b" };
  if (rank <= 2000)  return { label: "Top 1.2% — Outstanding",  colour: "#10b981" };
  if (rank <= 5000)  return { label: "Top 3% — Excellent",      colour: "var(--c-success)" };
  if (rank <= 15000) return { label: "Top 10% — Strong",        colour: "var(--c-brand-500)" };
  if (rank <= 40000) return { label: "Top 25% — Good",          colour: "var(--c-brand-400)" };
  return               { label: "Keep practising",              colour: "var(--c-text-3)" };
}

export function formatTime(seconds: number) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export function scoreColour(pct: number) {
  if (pct >= 70) return "var(--c-success)";
  if (pct >= 40) return "var(--c-brand-500)";
  return "var(--c-error)";
}
