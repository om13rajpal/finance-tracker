import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.issues });
    return;
  }
  const status = (err as any).status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? "Internal error" });
};
