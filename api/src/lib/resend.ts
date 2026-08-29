import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = new Resend(env.RESEND_API_KEY);

export async function sendEmail(opts: { to: string; subject: string; text: string }): Promise<void> {
  await resend.emails.send({
    from: "Finance Tracker <onboarding@resend.dev>",
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
}
