// GET /admin/inquiry/:id - read-only card for one inquiry, behind Cloudflare Access.
//
// This is the destination of the "View this inquiry" link in the notification
// email sent by functions/api/inquiry.ts. The URL shape is pinned:
// {SITE_ORIGIN}/admin/inquiry/{id}. Cloudflare Pages file-based routing maps
// [id].ts to exactly one path segment, so params.id is the inquiry's UUID.
//
// Server-rendered HTML, no client-side JavaScript, no external resource of any
// kind. Read-only this session: no status changes, no notes, no delete.

interface Env {
  DB?: D1Database;
}

interface InquiryRow {
  id: string;
  created_at: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  business_name: string | null;
  service_interest: string | null;
  message: string;
  budget_hint: string | null;
  source_page: string;
  status: string;
}

// Duplicated from functions/api/inquiry.ts on purpose. There is no
// functions/_shared/ because Cloudflare's routing docs do not state whether an
// underscore-prefixed directory under functions/ is excluded from routing, and
// /api/inquiry is a public endpoint - a shared module that accidentally became a
// route would be a real exposure. Revisit during the CRM migration, when the
// behaviour can actually be tested. Keep the copies identical.
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const STYLE = `
  :root {
    --navy: #1A2744; --navy-deep: #0F1A30; --cyan: #00E5FF;
    --white: #F8FAFF; --muted: #96A2BF; --border: rgba(0, 180, 216, 0.25);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem; background: var(--navy-deep); color: var(--white);
    font-family: 'Libre Baskerville', Georgia, serif; line-height: 1.6;
  }
  main { max-width: 48rem; margin: 0 auto; }
  h1 { font-family: 'Work Sans', system-ui, sans-serif; font-size: 1.5rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 0.85rem; margin: 0 0 2rem; }
  a { color: var(--cyan); }
  .card { border: 1px solid var(--border); border-radius: 0.5rem; background: var(--navy); padding: 1.5rem; }
  dl { display: grid; grid-template-columns: minmax(8rem, max-content) 1fr; gap: 0.5rem 1.25rem; margin: 0; }
  dt {
    color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em;
    font-family: 'Work Sans', system-ui, sans-serif; padding-top: 0.15rem;
  }
  dd { margin: 0; overflow-wrap: anywhere; }
  .msg {
    white-space: pre-wrap; margin: 1.5rem 0 0; padding: 1rem;
    border-left: 2px solid var(--cyan); background: rgba(0, 180, 216, 0.06);
  }
  .missing { color: var(--muted); }
  .error { border: 1px solid rgba(255, 120, 120, 0.4); border-radius: 0.5rem; padding: 2rem; background: var(--navy); }
  .back { display: inline-block; margin-top: 1.5rem; font-family: 'Work Sans', system-ui, sans-serif; font-size: 0.85rem; }
  @media (max-width: 34rem) { dl { grid-template-columns: 1fr; gap: 0.15rem; } dd { margin-bottom: 0.6rem; } }
`;

function page(title: string, inner: string, status = 200): Response {
  const html =
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<meta name=\"robots\" content=\"noindex, nofollow\">" +
    "<title>" + escapeHtml(title) + "</title><style>" + STYLE + "</style></head>" +
    "<body><main>" + inner + "<a class=\"back\" href=\"/admin\">&larr; All inquiries</a></main></body></html>";
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function row(label: string, value: string | null): string {
  const v = value === null || value === ""
    ? "<span class=\"missing\">not provided</span>"
    : escapeHtml(value);
  return "<dt>" + escapeHtml(label) + "</dt><dd>" + v + "</dd>";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  // ACCESS TRIPWIRE - this is NOT the gate.
  //
  // The real gate is the Cloudflare Access application provisioned in task 02
  // (docs/cloudflare-backend-setup.md section 5), which must cover BOTH
  // itjustfitz.com and the .pages.dev hostname.
  //
  // This check tests the header's PRESENCE, not its SIGNATURE. It is meaningful
  // only because a Pages origin is reachable exclusively through Cloudflare's
  // edge, so an outside caller cannot supply or strip this header at will. Its
  // purpose is to make a misconfigured Access application fail CLOSED rather
  // than open.
  //
  // Full JWKS signature verification is roughly 30 lines and is deliberately
  // deferred to the CRM migration, when real client data sits behind these
  // routes. This is a recorded, accepted limitation - not an oversight.
  if (!request.headers.get("Cf-Access-Jwt-Assertion")) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const id = String(params.id ?? "");

  let found: InquiryRow | null;
  try {
    found = await env.DB!.prepare("select * from inquiries where id = ?")
      .bind(id)
      .first<InquiryRow>();
  } catch {
    return page(
      "Inquiry - database unreachable",
      "<h1>Inquiry</h1><p class=\"sub\">It Just Fitz</p>" +
        "<div class=\"error\"><p><strong>The database is unreachable.</strong></p>" +
        "<p>The D1 binding named <code>DB</code> is missing on this environment, or the query failed." +
        " Bindings are per-environment: setting one on Production does not set it on Preview.</p></div>",
      503,
    );
  }

  // A 404 here is REACHABLE IN NORMAL OPERATION, not just from a mistyped URL.
  // functions/api/inquiry.ts sends its notification email even when the database
  // write failed - that is the point of the best-effort design. In that case the
  // email deliberately omits this link, but an older link, a retried send, or a
  // deleted row can all land here. Say so plainly rather than rendering an empty
  // card, which would read as a bug in this page.
  if (!found) {
    return page(
      "Inquiry not found",
      "<h1>Inquiry not found</h1>" +
        "<p class=\"sub\">No record matches this id.</p>" +
        "<div class=\"error\">" +
        "<p>There is no inquiry with the id <code>" + escapeHtml(id) + "</code>.</p>" +
        "<p>If you arrived from a notification email, the database write for that submission" +
        " may have failed. The email itself carries the full submission inline in that case," +
        " so the lead is recoverable from the email alone - scroll back to it.</p></div>",
      404,
    );
  }

  const inner =
    "<h1>" + escapeHtml(found.contact_name) + "</h1>" +
    "<p class=\"sub\">Received " + escapeHtml(found.created_at) + "</p>" +
    "<div class=\"card\"><dl>" +
    row("Name", found.contact_name) +
    row("Email", found.contact_email) +
    row("Phone", found.contact_phone) +
    row("Business", found.business_name) +
    row("Interest", found.service_interest ?? "unspecified") +
    row("Budget", found.budget_hint) +
    row("Source", found.source_page) +
    row("Status", found.status) +
    row("Received", found.created_at) +
    row("Id", found.id) +
    "</dl>" +
    // white-space: pre-wrap so the visitor's line breaks survive.
    "<div class=\"msg\">" + escapeHtml(found.message) + "</div>" +
    "</div>";

  return page("Inquiry - " + found.contact_name, inner);
};
