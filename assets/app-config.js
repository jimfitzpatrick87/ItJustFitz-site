/*
 * It Just Fitz — shared front-end config.
 *
 * These values are SAFE to expose in the browser:
 *   - SUPABASE_ANON_KEY is gated by Row-Level Security (it can only do what
 *     the RLS policies allow — see supabase/migrations/0001_init.sql).
 *   - FUNCTIONS_BASE_URL is a public HTTPS endpoint.
 *
 * Secrets (Claude API key, Resend API key, service-role key) are NEVER placed
 * here — they live only in Supabase Edge Function secrets. See README-backend.md.
 *
 * Project ref: tbdvtaawjfxcbzcblnxg
 * Fill in SUPABASE_ANON_KEY from Supabase Dashboard -> Project Settings -> API.
 */
window.IJF_CONFIG = {
  SUPABASE_URL: "https://tbdvtaawjfxcbzcblnxg.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-SUPABASE-ANON-KEY",
  FUNCTIONS_BASE_URL: "https://tbdvtaawjfxcbzcblnxg.supabase.co/functions/v1",

  // Zeph chat widget endpoint (the landing page assistant).
  // Leave EMPTY in production until a public HTTPS tunnel to the local Ollama
  // is live (Cloudflare Tunnel / Tailscale Funnel). Empty => widget shows its
  // offline fallback. A visitor's browser cannot reach a localhost Ollama, so
  // a public, HTTPS, origin-locked endpoint is required for live chat.
  // For local dev only: "http://localhost:11434/api/chat".
  ZEPH_OLLAMA_URL: "",
  ZEPH_OLLAMA_MODEL: "ministral-3:8b"
};
