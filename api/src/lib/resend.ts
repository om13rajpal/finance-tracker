import { Resend } from "resend";
import { env } from "../config/env.js";
import { withRetry } from "./withRetry.js";

const resend = new Resend(env.RESEND_API_KEY);

// The Resend SDK does NOT throw on an API-level failure (bad key permission, unverified
// sender, rate limit, etc.): it resolves normally with `{ data: null, error: {...} }`.
// A caller that only awaits the call and ignores the return value, as this used to do,
// sees a successful promise resolution regardless of whether the email was ever actually
// sent. Explicitly checking `error` here and throwing is what makes a real send failure
// visible to `requestOtp`'s caller instead of silently reporting success. Wrapped in
// withRetry per this project's global constraint that every external call goes through it.
export async function sendEmail(opts: { to: string; subject: string; text: string }): Promise<void> {
  await withRetry(async () => {
    const { error } = await resend.emails.send({
      from: "Finance Tracker <finance@omrajpal.in>",
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
    if (error) {
      throw new Error(`Resend send failed: ${error.name} - ${error.message}`);
    }
  });
}
