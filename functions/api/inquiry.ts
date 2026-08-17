// POST /api/inquiry - public endpoint for the website intake form.
//
// Cloudflare Pages Function. Same-origin, so there is no CORS handling, no
// preflight, and no API key anywhere on the client. The landing page posts to
// the literal path '/api/inquiry'.
//
// Ported from supabase/functions/submit-inquiry/index.ts, which is good code and
// stays in the repo as the reference for the later CRM migration. The validation
// rules, the honeypot, the email regex, the length caps and the service-value
// coercion are all carried over deliberately unchanged.
//
// FOUR DELIBERATE CHANGES FROM THE ORIGINAL
//
// 1. THE DATABASE WRITE IS BEST-EFFORT. This is the whole point of the redesign.
//    The original returns 500 when the insert fails (index.ts:90-92) and the lead
//    is simply gone. Here the insert is wrapped so that any failure - a thrown
//    error, a D1 outage, or a missing DB binding entirely - is caught, recorded,
//    and execution continues to the email and the visitor's 200.
//    Email is the guaranteed delivery channel. The row is the durable reference.
//    Read the failure ordering below before changing anything in this file.
// 2. D1 instead of supabase-js. Parameter binding only; a value is never
//    interpolated into a SQL string.
// 3. Resend is called directly rather than through _shared/resend.ts. There is no
//    email_log table in D1 this session, so there is no send-record to write.
// 4. No CORS helper and no AI triage trigger. Triage is out of scope for the lead
//    path and belongs to the CRM migration.
//
// FAILURE ORDERING - the property this file exists to guarantee
//
//   parse        -> 400 on bad JSON            (nothing to save, nothing to send)
//   honeypot     -> 200, silently dropped      (no row, no email, by design)
//   validation   -> 400                        (the visitor can fix it and retry)
//   rate limit   -> 429, but FAILS OPEN        (a DB fault must not block a lead)
//   insert       -> best effort, never returns (failure is recorded, not fatal)
//   email        -> best effort, never throws
//   response     -> 200 unless BOTH the insert and the email failed
//
// The one case that returns 500 is both channels failing at once. At that point
// nothing captured the lead, and the front end's error message tells the visitor
// to email directly - which is the only remaining way to save it. Returning 200
// there would be a genuinely silent loss.
//
// Environment (all configured in the Cloudflare Pages dashboard, never in a repo):
//   DB              D1 binding for the itjustfitz database
//   RESEND_API_KEY  secret
//   RESEND_FROM     e.g. It Just Fitz <notifications@itjustfitz.com>
//   BRAND_EMAIL     recipient, itjustfitzai@gmail.com
//   SITE_ORIGIN     https://itjustfitz.com, no trailing slash
// See docs/cloudflare-backend-setup.md.

interface Env {
  DB?: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  BRAND_EMAIL?: string;
  SITE_ORIGIN?: string;
}

// Must stay in sync with the service_type domain and with the option values on
// the public form. An unrecognized value is coerced to null below rather than
// rejected, so a mismatch here does NOT surface as an error -- the inquiry saves
// with no service recorded and the owner alert reads "unspecified". Change this
// list and the form together, in the same commit.
// 'ai_websites' is intentionally absent: it is a legacy member kept only so
// historical rows still read, never something new submissions may set.
// 'ai_agents' and 'bi_analysis' are no longer offered on the public form but stay
// accepted here -- warm leads still arrive for that work and must not be dropped.
const VALID_SERVICE = ["ai_agents", "bi_analysis", "web_presence", "growth_plays", "care_plan"];

// Duplicated in functions/admin/inquiry/[id].ts on purpose. There is no
// functions/_shared/ because Cloudflare's routing docs do not state whether an
// underscore-prefixed directory under functions/ is excluded from routing, and
// /api/inquiry is a public endpoint - a shared module that accidentally became a
// route would be a real exposure. Revisit during the CRM migration, when the
// behaviour can actually be tested. Keep the two copies identical.
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Optional free-text field: trimmed to a string, or null when absent or blank.
function optional(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Honeypot - bots fill this hidden field. Silently accept and drop: no row, no
  // email, and a 200 so the bot never learns it was caught. Checked here as well
  // as in index.html, because a client-side check protects nothing.
  if (typeof body.company_url === "string" && body.company_url.trim() !== "") {
    return json({ ok: true });
  }

  const name = String(body.contact_name ?? "").trim();
  const email = String(body.contact_email ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!name || !email || !message) {
    return json({ error: "Name, email, and a message are required." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please provide a valid email address." }, 400);
  }
  if (name.length > 200 || message.length > 5000) {
    return json({ error: "That submission is too long." }, 400);
  }

  const serviceInterest = VALID_SERVICE.includes(String(body.service_interest))
    ? String(body.service_interest)
    : null;

  const phone = optional(body.contact_phone);
  const business = optional(body.business_name);
  const budget = optional(body.budget_hint);
  const sourcePage = optional(body.source_page) ?? "landing";

  // Stored lowercased: SQLite has no citext, so the Postgres original's
  // case-insensitive email column has to be normalized on the way in instead.
  // The rate-limit lookup below relies on this too.
  const emailKey = email.toLowerCase();

  // crypto.randomUUID() is safe here. The workspace rule about it throwing
  // applies to BROWSER JavaScript over plain HTTP, where it is gated behind a
  // secure context. This is the Cloudflare Workers runtime, where it is always
  // available. SQLite has no gen_random_uuid(), so the id is generated here.
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Soft rate limit, FAILS OPEN. Caps inquiries from one address in the last
  // hour. If the count query throws for any reason - D1 down, binding missing -
  // the submission is allowed through. A database problem must never block a
  // real lead, which is the same principle as the best-effort insert below.
  // The real defence is the Cloudflare rate limiting rule on /api/inquiry
  // (see docs/cloudflare-backend-setup.md section 6); this is a courtesy check.
  try {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const row = await env.DB!.prepare(
      "select count(*) as n from inquiries where contact_email = ? and created_at >= ?",
    )
      .bind(emailKey, hourAgo)
      .first<{ n: number }>();
    if ((row?.n ?? 0) >= 5) {
      return json(
        { error: "Too many inquiries from this address - please email itjustfitzai@gmail.com directly." },
        429,
      );
    }
  } catch {
    // Fail open on purpose. See the comment above.
  }

  // Best-effort insert. Nothing in this block may return, throw past the catch,
  // or otherwise skip the email below.
  let savedOk = false;
  try {
    await env.DB!.prepare(
      "insert into inquiries (id, created_at, contact_name, contact_email, contact_phone," +
        " business_name, service_interest, message, budget_hint, source_page, status)" +
        " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, createdAt, name, emailKey, phone, business, serviceInterest, message, budget, sourcePage, "new")
      .run();
    savedOk = true;
  } catch {
    // Deliberately swallowed. savedOk stays false, the email says so and carries
    // the full submission inline, and the visitor still gets a 200.
  }

  const origin = (env.SITE_ORIGIN ?? "https://itjustfitz.com").replace(/\/+$/, "");
  const brand = env.BRAND_EMAIL ?? "itjustfitzai@gmail.com";

  const detail =
    "<p><strong>" + escapeHtml(name) + "</strong>" +
    (business ? " - " + escapeHtml(business) : "") + "</p>" +
    "<p>Email: " + escapeHtml(email) +
    (phone ? " &middot; Phone: " + escapeHtml(phone) : "") + "</p>" +
    "<p>Interest: " + escapeHtml(serviceInterest ?? "unspecified") +
    (budget ? " &middot; Budget: " + escapeHtml(budget) : "") + "</p>" +
    "<p>Source: " + escapeHtml(sourcePage) + " &middot; Received: " + escapeHtml(createdAt) + "</p>" +
    "<p style=\"white-space:pre-wrap\">" + escapeHtml(message) + "</p>";

  // When the insert failed there is no row to link to, so the email must be
  // self-sufficient rather than a pointer to a card that would 404. It carries
  // the full submission above and says plainly what happened. This is the case
  // the whole best-effort design exists for.
  const html = savedOk
    ? "<h2>New inquiry</h2>" + detail +
      "<p><a href=\"" + origin + "/admin/inquiry/" + id + "\">View this inquiry</a></p>" +
      "<p><a href=\"" + origin + "/admin\">All inquiries</a></p>"
    : "<h2>New inquiry - NOT SAVED TO THE DATABASE</h2>" +
      "<p>The database write failed, so there is no record to open and no link to follow." +
      " The full submission is below - reply to this email to reach the sender.</p>" +
      detail +
      "<p>Inquiry id that would have been used: " + escapeHtml(id) + "</p>";

  // Fail-soft, but NOT silent. An earlier version set emailOk = res.ok and threw
  // the status and body away, so a missing key (401), an unverified sending
  // domain (403), a malformed "from" (422) and a network error all produced the
  // same observable: nothing at all, not even a Resend dashboard entry, because
  // Resend does not log a request it rejected at auth. That made a real failure
  // undiagnosable without a redeploy. Log the reason; never log the key.
  let emailOk = false;
  let emailErr = "";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + (env.RESEND_API_KEY ?? ""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM ?? "It Just Fitz <notifications@itjustfitz.com>",
        to: brand,
        subject: (savedOk ? "New project inquiry - " : "New project inquiry (UNSAVED) - ") + name,
        html,
      }),
    });
    emailOk = res.ok;
    if (!emailOk) {
      // Resend returns a JSON error body describing exactly what it objected to.
      emailErr = "http " + res.status + " " + (await res.text()).slice(0, 400);
    }
  } catch (err) {
    // Still swallowed - a Resend outage must not turn a saved lead into an error
    // page - but the reason is now recorded rather than discarded.
    emailErr = "threw: " + (err instanceof Error ? err.message : String(err));
  }

  if (!emailOk) {
    // Visible in the Cloudflare dashboard under Workers & Pages -> the project ->
    // Logs. The key itself is never included; only whether one was configured.
    console.error(
      "[inquiry] resend send failed: " + emailErr +
      " | key_present=" + (env.RESEND_API_KEY ? "yes" : "NO") +
      " | from=" + (env.RESEND_FROM ?? "(unset, using default)") +
      " | to=" + brand +
      " | saved=" + savedOk +
      " | inquiry_id=" + id,
    );
  }

  // Both channels failed: nothing captured this lead. Tell the visitor, so the
  // front end shows "please email itjustfitzai@gmail.com directly" instead of a
  // success message for a submission that went nowhere.
  if (!savedOk && !emailOk) {
    return json({ error: "Could not send your inquiry. Please email itjustfitzai@gmail.com directly." }, 500);
  }

  return json({ ok: true, inquiry_id: id });
};
