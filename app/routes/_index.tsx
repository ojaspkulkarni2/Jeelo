import { redirect, Link } from "react-router";
import type { Route } from "./+types/_index";
import { getUser } from "~/lib/auth.server";
import { IconLayers, IconTests, IconCheck, IconPlay, IconTarget, IconGraph, IconFlash, IconX } from "~/components/icons";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getUser(request, context.cloudflare.env);
  if (user) throw redirect("/library");
  return null;
}

// ── Layered chain visual ───────────────────────────────────────

function LayeredChainVisual() {
  const layers = [
    { label: "JEE Mock #4",           sublabel: "75 questions · original test",       score: "142 / 300", done: true  },
    { label: "Layer 2 · Missed Qs",   sublabel: "31 questions · built from mistakes", score: "88 / 124",  done: true  },
    { label: "Layer 3 · Still Wrong", sublabel: "9 questions · the stubborn ones",    score: null,        done: false },
  ];

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 460, margin: "0 auto", userSelect: "none" }}>
      <div style={{
        position: "absolute", top: -10, left: "50%",
        transform: "translateX(-50%) rotate(-1.5deg)",
        width: "88%", height: 60, borderRadius: 14,
        background: "var(--c-brand-100)", border: "1px solid var(--c-brand-200)",
        opacity: 0.6,
      }} aria-hidden="true" />

      <div style={{
        position: "relative", zIndex: 2,
        borderRadius: 18, background: "var(--c-surface)",
        border: "1.5px solid var(--c-border-strong)",
        overflow: "hidden",
        boxShadow: "var(--shadow-lg)",
        animation: "fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.3s both",
      }}>
        <div style={{ padding: "16px 20px 14px", borderBottom: "1px solid var(--c-border)", background: "var(--c-subtle)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--c-brand-500)", marginBottom: 4 }}>
            Layered Test Chain
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-text)" }}>Physics Mechanics</div>
        </div>

        <div style={{ padding: "10px 0" }}>
          {layers.map((layer, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 20px",
              background: !layer.done ? "rgba(215,118,86,0.06)" : undefined,
              borderLeft: !layer.done ? "2px solid var(--c-brand-400)" : "2px solid transparent",
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                background: layer.done ? "var(--c-brand-500)" : "var(--c-brand-100)",
                border: layer.done ? "none" : "1.5px dashed var(--c-brand-400)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: layer.done ? "#fff" : "var(--c-brand-500)",
                fontSize: 11, fontWeight: 700,
              }}>
                {layer.done ? <IconCheck size={13} strokeWidth={2.5} /> : i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {layer.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--c-text-3)", marginTop: 1 }}>{layer.sublabel}</div>
              </div>
              {layer.done ? (
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-2)", flexShrink: 0 }}>{layer.score}</div>
              ) : (
                <div style={{
                  background: "var(--c-brand-500)", color: "#fff",
                  borderRadius: 6, padding: "4px 10px",
                  fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                }}>
                  <IconPlay size={9} /> Take
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--c-border)", background: "var(--c-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            {layers.map((l, i) => (
              <div key={i} style={{
                width: l.done ? 18 : 6, height: 6, borderRadius: 3,
                background: l.done ? "var(--c-brand-500)" : "var(--c-border-strong)",
              }} />
            ))}
          </div>
          <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>Layer 3 of 3 — almost there</span>
        </div>
      </div>
    </div>
  );
}

// ── Redo Missed simulation ─────────────────────────────────────

function RedoMissedVisual() {
  const questions = [
    { n: 3,  status: "wrong",   subject: "Phys" },
    { n: 7,  status: "skipped", subject: "Chem" },
    { n: 11, status: "wrong",   subject: "Phys" },
    { n: 14, status: "wrong",   subject: "Math" },
    { n: 18, status: "skipped", subject: "Chem" },
    { n: 22, status: "wrong",   subject: "Math" },
  ];

  return (
    <div style={{
      borderRadius: 14, background: "var(--c-surface)",
      border: "1.5px solid var(--c-border-strong)",
      overflow: "hidden",
      boxShadow: "var(--shadow-md)",
      animation: "fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.5s both",
    }}>
      <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--c-border)", background: "var(--c-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text-3)" }}>After submitting your test</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)", marginTop: 2 }}>6 questions missed</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-error)" }}>
            <IconX size={11} strokeWidth={2.5} /> 4 wrong
          </div>
          <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>2 skipped</div>
        </div>
      </div>

      <div style={{ padding: "10px 18px", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {questions.map((q) => (
          <div key={q.n} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            padding: "6px 8px", borderRadius: 7,
            background: q.status === "wrong" ? "rgba(192,48,42,0.08)" : "var(--c-subtle)",
            border: `1px solid ${q.status === "wrong" ? "rgba(192,48,42,0.2)" : "var(--c-border)"}`,
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: q.status === "wrong" ? "var(--c-error)" : "var(--c-text-3)" }}>Q{q.n}</span>
            <span style={{ fontSize: 9, color: "var(--c-text-3)" }}>{q.subject}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: "12px 18px 14px", borderTop: "1px solid var(--c-border)" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--c-brand-500)", borderRadius: 10,
          padding: "12px 16px",
          boxShadow: "0 4px 18px rgba(215,118,86,0.4)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 7, padding: "6px 7px", display: "flex" }}>
              <IconLayers size={15} strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Redo missed (6)</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", marginTop: 1 }}>Creates Layer 2 instantly</div>
            </div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 18, fontWeight: 300 }}>→</div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="land-shell">
      {/* Nav */}
      <header className="land-nav">
        <span className="land-nav-logo">Jeelo</span>
        <div className="land-nav-actions">
          <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
          <Link to="/signup" className="btn btn-primary btn-sm">Get started</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="land-hero" style={{ alignItems: "center", gap: 60 }}>
        <div style={{ animation: "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both" }}>
          <div className="land-hero-eyebrow">
            <IconLayers size={13} />
            Layered Tests
          </div>

          <h1 className="land-hero-h1">
            Every mistake<br />becomes the<br /><em>next test.</em>
          </h1>

          <p className="land-hero-body">
            Take a JEE-style test. Every question you got wrong or skipped
            is automatically compiled into a targeted Layer 2 drill.
            Repeat until nothing slips through.
          </p>

          <div className="land-hero-ctas">
            <Link to="/signup" className="btn btn-primary btn-lg">Start for free</Link>
            <Link to="/login" className="btn btn-ghost btn-lg">Sign in →</Link>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 460 }}>
          <img
            src="/jeelo-jumping.png"
            alt="Jeelo mascot"
            className="land-mascot"
            draggable={false}
          />
          <div className="land-visual" style={{ width: "100%" }}>
            <LayeredChainVisual />
          </div>
        </div>
      </section>

      {/* The Loop */}
      <section className="land-how">
        <div className="land-how-inner">
          <p className="land-section-label">The loop</p>
          <h2 className="land-section-title">Take it. Miss it. Drill it. Repeat.</h2>

          <div className="land-steps">
            <div className="land-step">
              <div className="land-step-num">1</div>
              <p className="land-step-title">Take your test</p>
              <p className="land-step-body">
                Build a custom test from your question bank — any subject, any type,
                exact JEE marking scheme. Or auto-generate in one click. Run it in
                the full NTA-format interface under timed conditions.
              </p>
            </div>
            <div className="land-step">
              <div className="land-step-num">2</div>
              <p className="land-step-title">Hit "Redo missed"</p>
              <p className="land-step-body">
                One button on your result page. Every wrong answer and every skipped
                question is compiled into a new test — Layer 2 — targeting exactly
                what you don't know. No manual sifting, no guessing what to revise.
              </p>
            </div>
            <div className="land-step">
              <div className="land-step-num">3</div>
              <p className="land-step-title">Close the loop</p>
              <p className="land-step-body">
                Each layer gets shorter as your weak spots shrink. Repeat until
                every question in the original test has been answered correctly.
                The chain ends when the work is done.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Redo Missed spotlight */}
      <section className="land-spotlight">
        <div className="land-spotlight-grid">
          <div style={{ animation: "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both" }}>
            <p className="land-section-label" style={{ marginBottom: 12 }}>The core feature</p>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 3vw, 40px)", letterSpacing: "-0.03em", color: "var(--c-text)", lineHeight: 1.15, marginBottom: 18 }}>
              One button.<br />Zero wasted revision.
            </h2>
            <p style={{ fontSize: 15, color: "var(--c-text-2)", lineHeight: 1.65, marginBottom: 16 }}>
              After every test, <strong style={{ color: "var(--c-text)" }}>Redo missed</strong> appears on
              your result page. Tap it and Jeelo instantly builds a new test
              from only the questions you got wrong or skipped — nothing more, nothing less.
            </p>
            <p style={{ fontSize: 15, color: "var(--c-text-2)", lineHeight: 1.65, marginBottom: 28 }}>
              Most students re-read chapters or redo full tests. Jeelo forces you to
              confront the exact questions that beat you, in the same timed, high-pressure
              NTA format. That's the only revision that sticks.
            </p>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 18px", borderRadius: 12, background: "var(--c-brand-50)", border: "1px solid var(--c-brand-100)" }}>
              <IconLayers size={18} style={{ color: "var(--c-brand-500)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, color: "var(--c-brand-700)", fontWeight: 500, lineHeight: 1.6 }}>
                Each layer is a shorter, sharper test built from the previous layer's failures.
                The chain ends when you've answered everything correctly.
              </span>
            </div>
          </div>

          <div style={{ animation: "fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both" }}>
            <RedoMissedVisual />
          </div>
        </div>
      </section>

      {/* Other features */}
      <section className="land-features" style={{ paddingTop: 0 }}>
        <p className="land-section-label">Everything else</p>
        <h2 className="land-section-title">Built for serious JEE prep.</h2>

        <div className="land-feat-grid">
          <div className="land-feat-card">
            <div className="land-feat-icon"><IconTests size={20} /></div>
            <p className="land-feat-title">Build Your Own Tests</p>
            <p className="land-feat-body">
              Configure every section — subject, type (SCQ, MCQ, Integer, Numerical),
              and exact JEE marking. Auto-generate from presets in one click.
            </p>
          </div>

          <div className="land-feat-card">
            <div className="land-feat-icon"><IconFlash size={20} /></div>
            <p className="land-feat-title">Full NTA Interface</p>
            <p className="land-feat-body">
              Timed, section-locked, with a live question palette. The same
              pressure as the real exam — not a quiz, a mock test.
            </p>
          </div>

          <div className="land-feat-card">
            <div className="land-feat-icon"><IconTarget size={20} /></div>
            <p className="land-feat-title">Rank Estimator</p>
            <p className="land-feat-body">
              Each result shows an estimated JEE Advanced rank using a Gaussian
              model fitted from 2012–2025 cutoff data.
            </p>
          </div>

          <div className="land-feat-card">
            <div className="land-feat-icon"><IconGraph size={20} /></div>
            <p className="land-feat-title">Subject Breakdown</p>
            <p className="land-feat-body">
              Accuracy per subject across every layer — see exactly which topics
              are closing and which ones still need work.
            </p>
          </div>

          <div className="land-feat-card">
            <div className="land-feat-icon"><IconCheck size={20} /></div>
            <p className="land-feat-title">Full Review Mode</p>
            <p className="land-feat-body">
              After every test, review every question with your answer vs the
              correct one side-by-side in the NTA-style interface.
            </p>
          </div>

          <div className="land-feat-card featured">
            <div className="land-feat-icon"><IconLayers size={20} /></div>
            <p className="land-feat-title">Layered Tests</p>
            <p className="land-feat-body">
              The feature that makes the difference. One button on your result
              page, and Jeelo builds the next layer automatically. The loop
              doesn't end until the work is done.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ display: "flex", justifyContent: "center" }}>
        <div className="land-cta">
          <h2 className="land-cta-title">Stop guessing what to revise.</h2>
          <p className="land-cta-body">
            Take your test. Hit Redo missed. Let Jeelo build the next one.
            The loop ends when you've answered everything correctly.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Link to="/signup" className="btn btn-primary btn-lg">Create free account</Link>
            <Link to="/login" className="btn btn-ghost btn-lg">Sign in</Link>
          </div>
        </div>
      </section>

      <footer className="land-footer">
        © {new Date().getFullYear()} Jeelo · Built for JEE aspirants
      </footer>
    </div>
  );
}
