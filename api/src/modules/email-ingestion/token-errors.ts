/**
 * Detects a Google API error caused by a revoked/invalid OAuth refresh token
 * (e.g. the user revoked access in their Google Account, or the token expired
 * from prolonged inactivity). Shared by every place that calls the Gmail API
 * on a user's behalf so they all react the same way: mark the connection
 * disconnected rather than retrying forever or failing silently.
 */
export function isTokenRevokedError(err: unknown): boolean {
  // Structurally typed rather than `any`: googleapis surfaces the status as either a
  // top-level `code` or a nested `response.status` depending on which layer threw, and
  // `invalid_grant` only ever shows up in the message text.
  const candidate = err as
    | { code?: unknown; response?: { status?: unknown }; message?: unknown }
    | null
    | undefined;
  return (
    candidate?.code === 401 ||
    candidate?.response?.status === 401 ||
    String(candidate?.message ?? "").includes("invalid_grant")
  );
}
