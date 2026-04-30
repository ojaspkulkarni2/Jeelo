import { data, redirect, Link } from "react-router";
import type { Route } from "./+types/tests.$id.result.overview";
import { getUser } from "~/lib/auth.server";
import {
  IconClock,
  IconTarget,
  IconGraph,
  IconChevronRight,
  IconLayers,
  IconCheck,
  IconX,
} from "~/components/icons";

// ── Types ──────────────────────────────────────────────────────

export interface SubjectBreakdown {
  subject: string;
  correct: number;
  wrong: number;
  skipped: number;
  total: number;
  score: number;
  max_score: number;
}

export interface ResultOverviewData {
  test_id: string;
  layer_id: string;
  layer_number: number;
  total_layers: number;
  test_title: string;
  score: number;
  max_score: number;
  correct: number;
  wrong: number;
  skipped: number;
  total_questions: number;
  time_taken_seconds: number;
  estimated_rank?: number | null;
  rank_percentile?: number | null;
  next_layer_id?: string | null;
  subjects: SubjectBreakdown[];
}

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await getUser(request, env);
  if (!user) throw redirect("/login");
  const { id } = params;
  // TODO: replace with real DB call
  const result: ResultOverviewData = {
    test_id: id,
    layer_id: "placeholder",
    layer_number: 1,
    total_layers: 1,
    test_title: "Test",
    score: 0,
    max_score: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
    total_questions: 0,
    time_taken_seconds: 0,
    subjects: [],
  };
  return data({ user, result });
}

// ── Helpers ────────────────────────────────────────────────────

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function scoreColour(pct: number) {
  if (pct >= 70) return "var(--c-success)";
  if (pct >= 40) return "var(--c-brand-500)";
  return "var(--c-error)";
}

function rankLabel(rank: number) {
  if (rank <= 100)  return "Top 100";
  if (rank <= 500)  return "Top 500";
  if (rank <= 1000) return "Top 1,000";
  if (rank <= 5000) return "Top 5,000";
  return `~${rank.toLocaleString()}`;
}

function rankBand(rank: number) {
  if (rank <= 100)  return { label: "Elite", color: "var(--c-success)" };
  if (rank <= 500)  return { label: "Excellent", color: "var(--c-success)" };
  if (rank <= 1000) return { label: "Very Good", color: "var(--c-brand-500)" };
  if (rank <= 5000) return { label: "Good", color: "var(--c-brand-500)" };
  return { label: "Keep Going", color: "var(--c-error)" };
}

// ── Page ────────────────────────────────────────────────────────

export default function ResultOverviewPage({ loaderData }: Route.ComponentProps) {
  const { result } = loaderData;
  const pct = result.max_score > 0
    ? Math.round((result.score / result.max_score) * 100)
    : 0;
  const hasNextLayer = !!result.next_layer_id;
  const accuracyPct = result.total_questions > 0
    ? Math.round((result.correct / result.total_questions) * 100)
    : 0;

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header */}
        <div className="pg-head">
          <div>
            <div className="result-breadcrumb">
              <Link to="/discover?mine=1" className="result-breadcrumb-link">My Tests</Link>
              <IconChevronRight size={13} />
              <span>{result.test_title}</span>
              {result.total_layers > 1 && (
                <>
                  <IconChevronRight size={13} />
                  <span>Layer {result.layer_number}</span>
                </>
              )}
            </div>
            <h1 className="pg-title">Results</h1>
          </div>
          <Link to={`/tests/${result.test_id}/result/review`} className="btn btn-ghost btn-sm">
            Review answers <IconChevronRight size={14} />
          </Link>
        </div>

        {/* Body */}
        <div className="pg-body">

          {/* ── Rank hero ── */}
          {result.estimated_rank != null ? (
            <div className="ro-rank-hero">
              <div className="ro-rank-main">
                <div className="ro-rank-label">Estimated JEE Advanced Rank</div>
                <div className="ro-rank-number">
                  {rankLabel(result.estimated_rank)}
                </div>
                <div className="ro-rank-band" style={{ color: rankBand(result.estimated_rank).color }}>
                  {rankBand(result.estimated_rank).label}
                </div>
                {result.rank_percentile != null && (
                  <div className="ro-rank-pct">Top {(100 - result.rank_percentile).toFixed(1)}% of candidates</div>
                )}
              </div>
              <div className="ro-rank-score-block">
                <span className="ro-rank-score-val" style={{ color: scoreColour(pct) }}>{result.score}</span>
                <span className="ro-rank-score-of">/{result.max_score}</span>
                <span className="ro-rank-score-label">Score</span>
              </div>
            </div>
          ) : (
            /* Fallback if no rank — score centred */
            <div className="ro-rank-hero" style={{ justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div className="ro-rank-label">Score</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 72, fontWeight: 800, lineHeight: 1, color: scoreColour(pct) }}>
                  {result.score}<span style={{ fontSize: 32, color: "var(--c-text-3)", fontWeight: 500 }}>/{result.max_score}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Key stats row ── */}
          <div className="ro-stats-row">
            <div className="ro-stat-big correct">
              <span className="ro-stat-big-val">{result.correct}</span>
              <span className="ro-stat-big-label"><IconCheck size={14} strokeWidth={2.5} /> Correct</span>
            </div>
            <div className="ro-stat-big wrong">
              <span className="ro-stat-big-val">{result.wrong}</span>
              <span className="ro-stat-big-label"><IconX size={14} strokeWidth={2.5} /> Wrong</span>
            </div>
            <div className="ro-stat-big skipped">
              <span className="ro-stat-big-val">{result.skipped}</span>
              <span className="ro-stat-big-label">Skipped</span>
            </div>
            <div className="ro-stat-big">
              <span className="ro-stat-big-val" style={{ color: scoreColour(accuracyPct) }}>{accuracyPct}%</span>
              <span className="ro-stat-big-label"><IconTarget size={14} /> Accuracy</span>
            </div>
            <div className="ro-stat-big">
              <span className="ro-stat-big-val" style={{ fontSize: 28 }}>{formatTime(result.time_taken_seconds)}</span>
              <span className="ro-stat-big-label"><IconClock size={14} /> Time taken</span>
            </div>
          </div>

          {/* Layer chain */}
          {result.total_layers > 1 && (
            <div className="ro-section">
              <p className="ro-section-label">
                <IconLayers size={13} /> Layer chain
              </p>
              <div className="ro-chain">
                {Array.from({ length: result.total_layers }, (_, i) => {
                  const n = i + 1;
                  const done    = n < result.layer_number;
                  const current = n === result.layer_number;
                  return (
                    <div key={n} className="ro-chain-item">
                      <div
                        className="ro-chain-node"
                        style={{
                          background: done ? "var(--c-success)" : current ? "var(--c-brand-500)" : "var(--c-border)",
                          color: done || current ? "#fff" : "var(--c-text-3)",
                        }}
                      >
                        {done ? <IconCheck size={11} strokeWidth={2.5} /> : n}
                      </div>
                      {i < result.total_layers - 1 && (
                        <div
                          className="ro-chain-connector"
                          style={{ background: done ? "var(--c-success)" : "var(--c-border)" }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Subject breakdown */}
          {result.subjects.length > 0 && (
            <div className="ro-section">
              <p className="ro-section-label">
                <IconGraph size={13} /> Subject breakdown
              </p>
              <div className="ro-subjects">
                {result.subjects.map((s) => {
                  const spct   = s.total > 0 ? (s.correct / s.total) * 100 : 0;
                  const colour = scoreColour(spct);
                  return (
                    <div key={s.subject} className="ro-subject-row">
                      <div className="ro-subject-header">
                        <span className="ro-subject-name">{s.subject}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 13, color: "var(--c-text-3)" }}>
                            <span style={{ color: "var(--c-success)", fontWeight: 600 }}>{s.correct}</span>
                            <span style={{ margin: "0 3px" }}>·</span>
                            <span style={{ color: "var(--c-error)", fontWeight: 600 }}>{s.wrong}</span>
                            <span style={{ margin: "0 3px" }}>·</span>
                            <span>{s.skipped}</span>
                          </span>
                          <span className="ro-subject-score" style={{ color: colour }}>
                            {s.score}/{s.max_score}
                          </span>
                        </div>
                      </div>
                      <div className="ro-bar-track">
                        <div className="ro-bar-fill" style={{ width: `${spct}%`, background: colour }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="ro-cta-row">
            <Link to="/discover?mine=1" className="btn btn-primary">
              Back to My Tests
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
