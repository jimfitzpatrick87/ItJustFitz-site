// GET /admin - read-only list of inquiries, behind Cloudflare Access.
//
// Cloudflare Pages Function. Server-rendered HTML, no client-side JavaScript,
// no external resource of any kind: no CDN script, no webfont, no remote image.
// The font stack below names the site's families and falls back to system fonts
// when they are not installed, which is the correct trade for an admin page that
// must stay fast and self-contained.
//
// Read-only this session. No status changes, no notes, no delete. Writes belong
// to the CRM migration.

interface Env {
  DB?: D1Database;
}

interface InquiryRow {
  id: string;
  created_at: string;
  contact_name: string;
  business_name: string | null;
  service_interest: string | null;
  status: string;
}

// Duplicated in functions/api/inquiry.ts and functions/admin/inquiry/[id].ts on
// purpose. There is no functions/_shared/ because Cloudflare's routing docs do
// not state whether an underscore-prefixed directory under functions/ is
// excluded from routing, and /api/inquiry is a public endpoint - a shared module
// that accidentally became a route would be a real exposure. Revisit during the
// CRM migration, when the behaviour can actually be tested. Keep the copies
// identical.
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
  main { max-width: 68rem; margin: 0 auto; }
  h1, h2, th { font-family: 'Work Sans', system-ui, sans-serif; letter-spacing: -0.01em; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  .sub { color: var(--muted); font-size: 0.85rem; margin: 0 0 2rem; }
  a { color: var(--cyan); }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.7rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
  tr:hover td { background: rgba(0, 180, 216, 0.06); }
  .wrap { overflow-x: auto; }
  .empty, .error {
    border: 1px solid var(--border); border-radius: 0.5rem; padding: 2rem;
    text-align: center; color: var(--muted); background: var(--navy);
  }
  .error { border-color: rgba(255, 120, 120, 0.4); }
  .pill {
    display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px;
    border: 1px solid var(--border); font-size: 0.75rem; color: var(--muted);
    font-family: 'Work Sans', system-ui, sans-serif;
  }
`;

function page(title: string, inner: string): Response {
  const html =
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<meta name=\"robots\" content=\"noindex, nofollow\">" +
    "<title>" + escapeHtml(title) + "</title><style>" + STYLE + "</style></head>" +
    "<body><main>" + inner + "</main></body></html>";
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
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

  let rows: InquiryRow[];
  try {
    const result = await env.DB!.prepare(
      "select id, created_at, contact_name, business_name, service_interest, status" +
        " from inquiries order by created_at desc limit 200",
    ).all<InquiryRow>();
    rows = result.results ?? [];
  } catch {
    // A missing DB binding or a query failure renders a real error page. Never a
    // bare 500 with no body, and never an uncaught throw - either one reads as a
    // platform fault and sends the next hour to the wrong layer.
    return page(
      "Admin - database unreachable",
      "<h1>Inquiries</h1><p class=\"sub\">It Just Fitz</p>" +
        "<div class=\"error\"><p><strong>The database is unreachable.</strong></p>" +
        "<p>The D1 binding named <code>DB</code> is missing on this environment, or the query failed." +
        " Bindings are per-environment: setting one on Production does not set it on Preview.</p>" +
        "<p>New inquiries are still being emailed - the notification path does not depend on this page.</p>" +
        "</div>",
    );
  }

  if (rows.length === 0) {
    return page(
      "Admin - inquiries",
      "<h1>Inquiries</h1><p class=\"sub\">It Just Fitz</p>" +
        "<div class=\"empty\"><p><strong>No inquiries yet.</strong></p>" +
        "<p>This page is working - the table is genuinely empty.</p></div>",
    );
  }

  const body = rows
    .map(
      (r) =>
        "<tr>" +
        "<td>" + escapeHtml(r.created_at) + "</td>" +
        "<td><a href=\"/admin/inquiry/" + escapeHtml(r.id) + "\">" + escapeHtml(r.contact_name) + "</a></td>" +
        "<td>" + escapeHtml(r.business_name ?? "-") + "</td>" +
        "<td>" + escapeHtml(r.service_interest ?? "unspecified") + "</td>" +
        "<td><span class=\"pill\">" + escapeHtml(r.status) + "</span></td>" +
        "</tr>",
    )
    .join("");

  return page(
    "Admin - inquiries",
    "<h1>Inquiries</h1>" +
      "<p class=\"sub\">" + rows.length + " shown, newest first (limit 200)</p>" +
      "<div class=\"wrap\"><table><thead><tr>" +
      "<th>Received</th><th>Name</th><th>Business</th><th>Interest</th><th>Status</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table></div>",
  );
};
