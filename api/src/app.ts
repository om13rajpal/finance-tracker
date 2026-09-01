import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { authRouter } from "./modules/auth/auth.routes.js";
import { categoriesRouter } from "./modules/categories/categories.routes.js";
import { categorizationRouter } from "./modules/categorization/categorization.routes.js";
import { accountsRouter } from "./modules/accounts/accounts.routes.js";
import { transactionsRouter } from "./modules/transactions/transactions.routes.js";
import { pendingTransactionsRouter } from "./modules/transactions/pending.routes.js";
import { csvImportRouter } from "./modules/transactions/csv-import/csv-import.routes.js";
import { statementUploadRouter } from "./modules/statements/statement-upload.routes.js";
import { statementPasswordsRouter } from "./modules/statements/statement-passwords.routes.js";
import { investmentsRouter } from "./modules/investments/investments.routes.js";
import { recurringRouter } from "./modules/recurring/recurring.routes.js";
import { goalsRouter } from "./modules/goals/goals.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { exportRouter } from "./modules/export/export.routes.js";
import { gmailRouter } from "./modules/email-ingestion/gmail.routes.js";
import { gmailWebhookRouter } from "./modules/email-ingestion/gmail-webhook.routes.js";
import { capitalGainsRouter } from "./modules/tax/capital-gains.routes.js";
import { deductionsRouter } from "./modules/tax/deductions.routes.js";
import { incomeSourcesRouter } from "./modules/tax/income-sources.routes.js";
import { estimateRouter } from "./modules/tax/estimate.routes.js";
import { slabConfigRouter } from "./modules/tax/slab-config.routes.js";
import { errorHandler } from "./lib/errorHandler.js";

export const app = express();

app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Mounted before every other router, and specifically before
// `app.use("/", investmentsRouter)` below: that router is mounted at the
// app root, so its own `investmentsRouter.use(requireAuth)` middleware runs
// (and short-circuits with 401) for EVERY request path that reaches it,
// including "/webhooks/gmail" — regardless of whether investmentsRouter
// itself defines a matching route. `/webhooks/gmail` must be reachable
// without auth (Pub/Sub calls it directly, verified by its own shared
// secret instead), so it has to be resolved before the request pipeline
// ever reaches that root-mounted router.
app.use("/webhooks/gmail", gmailWebhookRouter);
// Mounted here, above the root-mounted investmentsRouter, for the same reason:
// GET /gmail/oauth/callback must be reachable with NO session cookie, because
// Google redirects the browser to it directly from accounts.google.com. Mounted
// after investmentsRouter it would be swallowed by that router's requireAuth and
// answer 401 to every real callback (it only appeared to work locally because
// cookies ignore port numbers, so the dev cookie set on localhost:3000 is also
// sent to localhost:4000 — that coincidence does not hold across two real
// deployed hostnames). The individual /gmail routes that DO need a session
// (connect, status, disconnect) carry their own per-route requireAuth.
app.use("/gmail", gmailRouter);

app.use("/auth", authRouter);
app.use("/categories", categoriesRouter);
app.use("/categorization-rules", categorizationRouter);
app.use("/accounts", accountsRouter);
app.use("/transactions", transactionsRouter);
app.use("/transactions", csvImportRouter);
app.use("/transactions", statementUploadRouter);
app.use("/pending-transactions", pendingTransactionsRouter);
app.use("/statement-passwords", statementPasswordsRouter);
// Mounted at root (not "/investments") so its internal routes resolve at the
// exact top-level paths the spec calls for (GET /holdings, /holding-lots,
// POST /investments/import). Side effect: its own requireAuth middleware runs
// for EVERY request that reaches this line, not just investment ones — any
// future route that must stay unauthenticated (like /webhooks/gmail above)
// has to be mounted BEFORE this line, never after it.
app.use("/", investmentsRouter);
app.use("/recurring", recurringRouter);
app.use("/goals", goalsRouter);
app.use("/dashboard", dashboardRouter);
app.use("/export", exportRouter);
app.use("/tax/capital-gains", capitalGainsRouter);
app.use("/tax/deductions", deductionsRouter);
app.use("/tax/income-sources", incomeSourcesRouter);
app.use("/tax/estimate", estimateRouter);
app.use("/tax/slab-config", slabConfigRouter);
// gmailRouter is mounted near the top of this file, not here — see the comment there.
// ... other routers mount here in later tasks ...
app.use(errorHandler); // must be last
