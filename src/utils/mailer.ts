/**
 * No SMTP provider is configured for this project yet, so "sending" an email
 * means logging it to the server console — the link/code is still real and
 * still works, it just isn't delivered to an inbox. Swap this function's body
 * for a real provider call (nodemailer, Resend, etc.) once SMTP credentials
 * exist; every caller already treats it as fire-and-forget.
 */
export async function sendMail(options: { to: string; subject: string; text: string }): Promise<void> {
  console.log(`[email:dev] to=${options.to} subject="${options.subject}"\n${options.text}`);
}
