import { data, Form } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/settings";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconUser, IconSettings, IconCheck } from "~/components/icons";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: settings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    user,
    settings: settings ?? {
      display_name: user.display_name,
      default_duration_mins: 180,
      default_marks_correct: 4,
      default_marks_wrong: -1,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "update_profile") {
    const displayName = String(formData.get("display_name") ?? "").trim();
    if (!displayName) return data({ error: "Display name is required" }, { status: 400 });

    await supabase
      .from("users")
      .update({ display_name: displayName })
      .eq("id", user.id);

    return data({ success: "profile" });
  }

  if (intent === "update_test_defaults") {
    const defaultDuration = parseInt(String(formData.get("default_duration_mins") ?? ""), 10);
    const defaultCorrect  = parseFloat(String(formData.get("default_marks_correct") ?? ""));
    const defaultWrong    = parseFloat(String(formData.get("default_marks_wrong") ?? ""));

    if (isNaN(defaultDuration) || defaultDuration <= 0)
      return data({ error: "Invalid duration" }, { status: 400 });

    await supabase.from("user_settings").upsert({
      user_id: user.id,
      display_name: user.display_name,
      default_duration_mins: defaultDuration,
      default_marks_correct: defaultCorrect,
      default_marks_wrong: defaultWrong > 0 ? -defaultWrong : defaultWrong,
    }, { onConflict: "user_id" });

    return data({ success: "test_defaults" });
  }

  return null;
}

function SettingsSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          padding: "18px 24px",
          borderBottom: "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ color: "var(--c-brand-500)" }}>{icon}</div>
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--c-text)",
              lineHeight: 1.3,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 12, color: "var(--c-text-3)", marginTop: 1 }}>
            {subtitle}
          </div>
        </div>
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
    </div>
  );
}

export default function SettingsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, settings } = loaderData;
  const successSection =
    actionData && "success" in actionData ? actionData.success : null;
  const error =
    actionData && "error" in actionData ? actionData.error : null;

  // Controlled state for duration chips — ensures loaded value shows as selected
  const [defaultDuration, setDefaultDuration] = useState(
    settings.default_duration_mins ?? 180
  );

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px 60px" }}>
          <div className="pg-head">
            <div>
              <h1 className="pg-title">Settings</h1>
              <p className="pg-subtitle">Manage your profile and test defaults</p>
            </div>
          </div>

          {error && (
            <div className="alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* ── Profile ── */}
          <SettingsSection
            icon={<IconUser size={18} />}
            title="Profile"
            subtitle="Your name shown to other users on published tests"
          >
            <Form
              method="post"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <input type="hidden" name="intent" value="update_profile" />

              <div className="field">
                <label className="label" htmlFor="display_name">
                  Display name
                </label>
                <input
                  id="display_name"
                  name="display_name"
                  className="input"
                  defaultValue={user.display_name}
                  required
                  autoComplete="name"
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save profile
                </button>
                {successSection === "profile" && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      color: "var(--c-success)",
                      fontWeight: 500,
                    }}
                  >
                    <IconCheck size={13} /> Saved
                  </span>
                )}
              </div>
            </Form>
          </SettingsSection>

          {/* ── Test Defaults ── */}
          <SettingsSection
            icon={<IconSettings size={18} />}
            title="Test Defaults"
            subtitle="Pre-filled values when you create a new test or section"
          >
            <Form
              method="post"
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              <input type="hidden" name="intent" value="update_test_defaults" />

              {/* Duration */}
              <div className="field">
                <label className="label">Default duration</label>
                <div className="create-test-duration-row">
                  {[60, 90, 120, 180].map((mins) => (
                    <label key={mins} className="create-test-duration-chip">
                      <input
                        type="radio"
                        name="default_duration_mins"
                        value={mins}
                        checked={defaultDuration === mins}
                        onChange={() => setDefaultDuration(mins)}
                        style={{ display: "none" }}
                      />
                      <span>
                        {mins === 60
                          ? "1h"
                          : mins === 90
                          ? "1h 30m"
                          : mins === 120
                          ? "2h"
                          : "3h"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Marks */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div className="field">
                  <label className="label" htmlFor="default_marks_correct">
                    Marks for correct answer
                  </label>
                  <input
                    id="default_marks_correct"
                    name="default_marks_correct"
                    type="number"
                    step="0.5"
                    className="input"
                    defaultValue={settings.default_marks_correct}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="default_marks_wrong">
                    Negative marking
                  </label>
                  <input
                    id="default_marks_wrong"
                    name="default_marks_wrong"
                    type="number"
                    step="0.5"
                    className="input"
                    defaultValue={settings.default_marks_wrong}
                    placeholder="e.g. -1"
                  />
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--c-text-3)",
                      marginTop: 4,
                    }}
                  >
                    Enter a negative number (e.g. −1) or 0 for no penalty.
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save defaults
                </button>
                {successSection === "test_defaults" && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      color: "var(--c-success)",
                      fontWeight: 500,
                    }}
                  >
                    <IconCheck size={13} /> Saved
                  </span>
                )}
              </div>
            </Form>
          </SettingsSection>
        </div>
      </main>
    </div>
  );
}
