function getBearerToken(req) {
  const header = String(req?.headers?.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

let cachedAuth = null;
async function getAdminAuth() {
  if (cachedAuth) return cachedAuth;
  const { default: admin } = await import("../admin.js");
  cachedAuth = admin.auth();
  return cachedAuth;
}

export async function requireUser(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({
      error: "Missing Authorization Bearer token",
    });
  }

  try {
    const auth = await getAdminAuth();
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({
      error: "Invalid or expired Authorization token",
    });
  }
}

