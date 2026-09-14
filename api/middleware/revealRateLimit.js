import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Throttles credential /reveal endpoints to prevent bulk scraping if a token leaks.
 * Keyed by requester identity (not IP) since dashboard and portal users share infra.
 * In-memory store — fine for a single-instance deployment; resets on restart/redeploy.
 */
export const revealRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user?.id) return `team:${req.user.id}`;
    if (req.portalUser?.id) return `portal:${req.portalUser.id}`;
    return ipKeyGenerator(req.ip);
  },
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many credential reveal requests, please try again shortly" });
  },
});
