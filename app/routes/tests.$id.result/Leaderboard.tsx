import { useState } from "react";
import type { LeaderboardEntry } from "./types";
import { formatTime, scoreColour } from "./rank-estimator";

export function Leaderboard({ entries, testMaxMarks }: { entries: LeaderboardEntry[]; testMaxMarks: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, 5);
  if (entries.length === 0) return null;

  return (
    <div className="ro-section" style={{ marginTop: 14 }}>
      <p className="ro-section-label" style={{ marginBottom: 12 }}>
        Leaderboard — {entries.length} student{entries.length !== 1 ? "s" : ""}
      </p>
      <div className="lb-table">
        <div className="lb-row lb-header">
          <span className="lb-col-rank">#</span>
          <span className="lb-col-name">Student</span>
          <span className="lb-col-score">Score</span>
          <span className="lb-col-stat">✓</span>
          <span className="lb-col-stat">✗</span>
          <span className="lb-col-time">Time</span>
        </div>
        {visible.map((e, i) => {
          const pct = testMaxMarks > 0 ? Math.round((e.score / testMaxMarks) * 100) : 0;
          const col = scoreColour(pct);
          return (
            <div key={e.student_id} className={`lb-row${e.is_me ? " lb-row-me" : ""}${i === 0 ? " lb-row-top" : ""}`}>
              <span className="lb-col-rank lb-rank-num">
                {i === 0 ? "#1" : i === 1 ? "#2" : i === 2 ? "#3" : `#${i + 1}`}
              </span>
              <span className="lb-col-name lb-name-cell">
                {e.display_name}
                {e.is_me && <span className="lb-you-badge">you</span>}
              </span>
              <span className="lb-col-score" style={{ color: col, fontWeight: 700 }}>
                {e.score}
                <span className="lb-score-of">/{testMaxMarks}</span>
                <span className="lb-score-pct"> {pct}%</span>
              </span>
              <span className="lb-col-stat" style={{ color: "var(--c-success)" }}>{e.correct}</span>
              <span className="lb-col-stat" style={{ color: "var(--c-error)" }}>{e.wrong}</span>
              <span className="lb-col-time">{formatTime(e.time_taken_seconds)}</span>
            </div>
          );
        })}
      </div>
      {entries.length > 5 && (
        <button onClick={() => setExpanded(v => !v)} className="btn btn-ghost btn-sm" style={{ marginTop: 8, fontSize: 12 }}>
          {expanded ? "Show less ▲" : `Show all ${entries.length} ▼`}
        </button>
      )}
    </div>
  );
}
