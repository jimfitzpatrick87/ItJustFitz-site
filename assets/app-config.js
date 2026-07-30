/*
 * It Just Fitz -- shared front-end config.
 *
 * These values are SAFE to expose in the browser:
 *   - SUPABASE_ANON_KEY is gated by Row-Level Security (it can only do what
 *     the RLS policies allow -- see supabase/migrations/0001_init.sql).
 *   - FUNCTIONS_BASE_URL is a public HTTPS endpoint.
 *
 * Secrets (Claude API key, Resend API key, service-role key) are NEVER placed
 * here -- they live only in Supabase Edge Function secrets. See README-backend.md.
 *
 * Project ref: tbdvtaawjfxcbzcblnxg
 *
 * TODO (blocks go-live): SUPABASE_ANON_KEY below is still the placeholder string.
 * The form does NOT fail silently -- index.html substring-matches "YOUR-" and
 * short-circuits before any network call, showing "The inquiry form is not
 * configured yet. Please email ... directly." So a visitor sees an honest error,
 * but the form is decorative: no row reaches `inquiries` and no notification
 * fires. Most people who fill in a form will not then go and send an email.
 * Get the real key from Supabase Dashboard -> Project Settings -> API ->
 * anon/public. It is not a secret -- it ships in browser JS by design.
 *
 * Then prove the path end to end: submit from a browser, confirm the row lands
 * in `inquiries`, confirm the notification fires. Do NOT mark it done on a green
 * console -- the failure mode here is specifically a silent success. This is the
 * last item gating robots.txt (see docs/domain-hosting-runbook.md Step 6).
 */
window.IJF_CONFIG = {
  SUPABASE_URL: "https://tbdvtaawjfxcbzcblnxg.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-SUPABASE-ANON-KEY",
  FUNCTIONS_BASE_URL: "https://tbdvtaawjfxcbzcblnxg.supabase.co/functions/v1",

  // Pierce chat widget endpoint (the landing page assistant).
  // Leave EMPTY in production until a public HTTPS tunnel to the local Ollama
  // is live (Cloudflare Tunnel / Tailscale Funnel). Empty => widget shows its
  // offline fallback. A visitor's browser cannot reach a localhost Ollama, so
  // a public, HTTPS, origin-locked endpoint is required for live chat.
  // For local dev only: "http://localhost:11434/api/chat".
  PIERCE_OLLAMA_URL: "",
  PIERCE_OLLAMA_MODEL: "ministral-3:8b"
};
