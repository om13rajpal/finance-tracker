import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { env } from "../../config/env.js";
import { getAuthUrl, exchangeCodeForTokens, verifyOAuthState } from "./gmail-oauth.service.js";
import { registerWatch } from "./gmail-watch.service.js";
import { encrypt } from "../../lib/encryption.js";
import { GmailConnection } from "../../models/GmailConnection.js";

export const gmailRouter = Router();

gmailRouter.get("/connect", requireAuth, (req, res) => {
  res.redirect(getAuthUrl((req as any).userId));
});

gmailRouter.get("/status", requireAuth, async (req, res, next) => {
  try {
    const connection = await GmailConnection.findOne({ userId: (req as any).userId });
    res.json({ connected: connection?.status === "connected" });
  } catch (err) {
    next(err);
  }
});

// Not behind requireAuth: Google redirects the browser here directly. The userId
// therefore comes entirely from the `state` param, which must be one this API minted
// and signed in getAuthUrl (see signOAuthState's comment): an unsigned/forged/expired
// state is rejected outright rather than trusted as a userId.
gmailRouter.get("/oauth/callback", async (req, res, next) => {
  try {
    const userId = verifyOAuthState(req.query.state as string | undefined);
    if (!userId) {
      return res.status(400).json({ error: "Invalid or expired OAuth state" });
    }

    const code = req.query.code as string;
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    const { refreshToken } = await exchangeCodeForTokens(code);

    await GmailConnection.findOneAndUpdate(
      { userId },
      { refreshTokenEncrypted: encrypt(refreshToken), status: "connected", connectedAt: new Date() },
      { upsert: true }
    );

    // Register the actual push-notification watch now, not just the token.
    // Without this, the connection sits at status "connected" with no watch
    // ever registered: nothing Google-side is watching the inbox, so no
    // email ever triggers ingestion, and the daily renewal job's query
    // (watchExpiration <= cutoff) never rescues a connection whose
    // watchExpiration is still null from having skipped this step.
    // Failure here must not fail the OAuth callback itself: the token is
    // already saved, the user is already connected, and the renewal job
    // (which also now catches watchExpiration: null) will retry.
    try {
      await registerWatch(userId);
    } catch (err) {
      console.error(`Failed to register initial Gmail watch for user ${userId}:`, err);
    }

    res.redirect(`${env.WEB_ORIGIN}/settings?gmail=connected`);
  } catch (err) {
    next(err);
  }
});

gmailRouter.delete("/disconnect", requireAuth, async (req, res, next) => {
  try {
    await GmailConnection.findOneAndUpdate(
      { userId: (req as any).userId },
      { status: "disconnected", refreshTokenEncrypted: null }
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
