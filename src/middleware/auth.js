const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const [type, token] = auth.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

function ensureSchoolAccess(req, res, next) {
  const schoolId = req.params.schoolId || req.body.schoolId || req.query.schoolId;
  if (!schoolId) return res.status(400).json({ error: "schoolId missing" });
  if (req.user.role === "ADMIN" && req.user.schoolId === schoolId) return next();
  if (req.user.role === "TEACHER" && req.user.schoolId === schoolId) return next();
  return res.status(403).json({ error: "Forbidden for this school" });
}

module.exports = { requireAuth, requireRole, ensureSchoolAccess };
