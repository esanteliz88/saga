export function requireApiKey(req, res, next) {
  const header = req.headers["x-api-key"];
  const key = process.env.API_KEY;
  if (!key) return res.status(500).json({ error: "server_missing_api_key" });
  if (!header || String(header) !== String(key)) return res.status(401).json({ error: "unauthorized" });
  next();
}
