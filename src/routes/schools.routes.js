const express = require("express");
const School = require("../models/School");
const { requireAuth, ensureSchoolAccess } = require("../middleware/auth");

const router = express.Router();

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const school = await School.findById(req.params.schoolId).lean();
  if (!school) return res.status(404).json({ error: "School not found" });
  return res.json({
    id: String(school._id),
    name: school.name,
    schoolCode: school.schoolCode,
    adminEmail: school.adminEmail,
    createdAt: school.createdAt,
    timezone: school.timezone
  });
});

module.exports = router;
