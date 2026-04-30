import { Link } from "react-router";

export default function AboutPage() {
  return (
    <div className="land-shell">
      <header className="land-nav">
        <Link to="/" className="land-nav-logo">Jeelo</Link>
        <div className="land-nav-actions">
          <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
          <Link to="/signup" className="btn btn-primary btn-sm">Get started</Link>
        </div>
      </header>

      <section style={{ maxWidth: 640, margin: "0 auto", padding: "80px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <img src="/jeelo-reading.png" alt="Jeelo"
            style={{ width: 120, height: 120, objectFit: "contain", marginBottom: 20 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <h1 style={{ fontSize: 32, fontWeight: 800, color: "var(--c-text)", letterSpacing: "-0.03em", margin: 0 }}>
            A note from the founder
          </h1>
        </div>

        <div style={{ fontSize: 16, lineHeight: 1.8, color: "var(--c-text-2)" }}>
          <p>
            Every JEE aspirant has the same problem. The good questions are everywhere and nowhere.
            Scattered across modules, PDFs, coaching sheets, Telegram groups. 
            Nobody has ever put them all in one place and let students decide which ones actually matter.
          </p>
          <p>
            That's what Jeelo is trying to fix.
          </p>
          <p>
            The best questions aren't chosen by an editor or an algorithm working off clicks.
            They're chosen by collective performance. A question that 40% of serious students get wrong
            is worth more than a question 95% get right. Jeelo surfaces the former.
            The community, through its answers, builds the definitive question bank for JEE —
            question by question, chapter by chapter.
          </p>
          <p>
            The five-layer chapter system exists because I noticed that "knowing" a chapter
            and "being done with" a chapter are completely different things.
            Theory first — your own material, your own pace. Your questions next.
            Then the community's best. A practice test. Finally a layered test
            that doesn't let go until nothing slips through.
            A chapter isn't done until all five are done.
          </p>
          <p>
            Jeelo is built for aspirants who are serious enough to be honest with themselves.
            The map shows you exactly where you are. Your friends can see it too.
            The race is always on — but it's a race toward mastery, not just rank.
          </p>
          <p style={{ marginTop: 32, color: "var(--c-text-3)", fontStyle: "italic" }}>
            — The Jeelo Team
          </p>
        </div>

        <div style={{ marginTop: 48, textAlign: "center" }}>
          <Link to="/signup" className="btn btn-primary btn-lg">Start your map</Link>
        </div>
      </section>

      <footer className="land-footer">
        © {new Date().getFullYear()} Jeelo · Built for JEE aspirants ·{" "}
        <Link to="/about" style={{ color: "inherit" }}>About</Link>
      </footer>
    </div>
  );
}
