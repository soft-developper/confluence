/**
 * Minimal Resend client (POST https://api.resend.com/emails, Bearer API key; the optional
 * Idempotency-Key header makes retries safe for 24 hours).
 * https://resend.com/docs/api-reference/emails/send-email
 *
 * Emails never block the caller: failures are logged and swallowed.
 */
export interface EmailConfig {
  apiKey?: string | undefined;
  from?: string | undefined;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}

export type SendEmail = (m: EmailMessage) => Promise<boolean>;

export function createEmailSender(cfg: EmailConfig, fetchImpl: typeof fetch = fetch, log: (m: string) => void = console.log): SendEmail {
  return async (m) => {
    if (!cfg.apiKey || !cfg.from) {
      log(`email: skipped (RESEND_API_KEY or EMAIL_FROM not set): "${m.subject}"`);
      return false;
    }
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "confluence-api",
          ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey.slice(0, 256) } : {}),
        },
        body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        log(`email: Resend returned HTTP ${res.status} for "${m.subject}"`);
        return false;
      }
      return true;
    } catch (e) {
      log(`email: send failed for "${m.subject}": ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, readable security email (text and matching HTML). */
export function securityEmail(title: string, lines: string[], action?: { label: string; url: string }) {
  const text = [title, "", ...lines, ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "If this was not you, reset your password and your authenticator immediately."].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#0A121F">
<h2 style="font-size:18px">${esc(title)}</h2>
${lines.map((l) => `<p style="margin:6px 0">${esc(l)}</p>`).join("\n")}
${action ? `<p style="margin:18px 0"><a href="${esc(action.url)}" style="background:#5D5AEF;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(action.label)}</a></p>` : ""}
<p style="margin-top:18px;color:#667085;font-size:13px">If this was not you, reset your password and your authenticator immediately.</p>
</div>`;
  return { text, html };
}
