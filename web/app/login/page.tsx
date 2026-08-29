"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  // This page predates the app's TanStack Query mutations (which give every other
  // form its own `isPending` guard), so it tracks in-flight state by hand. Without
  // it, a double-click on "Send code" issues two OTP requests — and since each
  // request replaces the previous code, the code in the first email silently stops
  // working, which reads to the user as "the app sent me a broken code".
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function requestCode() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/otp/request", { method: "POST", body: JSON.stringify({ email }) });
      setStage("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/otp/verify", { method: "POST", body: JSON.stringify({ email, code }) });
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      // Deliberately NOT in a `finally`: on success this navigates away, and
      // re-enabling the button first would flash it live again mid-redirect.
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto mt-24 max-w-sm p-6">
      <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {stage === "email" ? (
        <div className="flex flex-col gap-3">
          <label htmlFor="login-email" className="text-sm">
            Email
            <input
              id="login-email"
              className="mt-1 w-full rounded border px-3 py-2"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button
            className="rounded bg-black px-3 py-2 text-white disabled:opacity-60"
            onClick={requestCode}
            disabled={submitting}
          >
            {submitting ? "Sending…" : "Send code"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label htmlFor="login-code" className="text-sm">
            Code
            <input
              id="login-code"
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button
            className="rounded bg-black px-3 py-2 text-white disabled:opacity-60"
            onClick={verifyCode}
            disabled={submitting}
          >
            {submitting ? "Verifying…" : "Verify"}
          </button>
        </div>
      )}
    </main>
  );
}
