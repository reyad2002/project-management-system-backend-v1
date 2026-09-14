import nodemailer from "nodemailer";

let cachedTransporter;

/**
 * Lazily build the SMTP transporter from env vars. Returns null (not configured) rather than
 * throwing, so callers can fall back to a log-only placeholder in dev/before secrets are set.
 *
 * Required: SMTP_USER, SMTP_PASS (a Gmail App Password if SMTP_HOST is smtp.gmail.com — Gmail
 * rejects the account password directly once 2FA is on).
 * Optional: SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465), SMTP_FROM (default
 * `"Code Wars" <SMTP_USER>`).
 */
function getTransporter() {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const { SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    cachedTransporter = null;
    return cachedTransporter;
  }

  const port = Number(SMTP_PORT) || 465;
  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return cachedTransporter;
}

/**
 * Send an email, or log a placeholder if SMTP isn't configured yet (same convention as the
 * rest of the codebase — see clientPortalUsersController's previous log-only stub).
 */
export async function sendEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] SMTP not configured (SMTP_USER/SMTP_PASS) — would send to ${to}: ${subject}`);
    return { sent: false };
  }

  const from = process.env.SMTP_FROM || `"Code Wars" <${process.env.SMTP_USER}>`;
  await transporter.sendMail({ from, to, subject, html, text });
  return { sent: true };
}
