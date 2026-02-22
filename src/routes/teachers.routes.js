const express = require("express");
const Teacher = require("../models/Teacher");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const { nextId } = require("../utils/id");

const router = express.Router();

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const rows = await Teacher.find({ schoolId: req.params.schoolId }).sort({ name: 1 }).lean();
  return res.json(rows);
});

router.post("/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const existing = await Teacher.find({ schoolId }).select({ id: 1 }).lean();
    const id = (req.body.id || "").trim() || nextId("T", existing.map((x) => x.id));
    const doc = await Teacher.create({
      schoolId,
      id,
      name: req.body.name,
      subjectIds: Array.isArray(req.body.subjectIds) ? req.body.subjectIds : [],
      classGroupIds: Array.isArray(req.body.classGroupIds) ? req.body.classGroupIds : [],
      level: req.body.level || "SENIOR",
      maxPeriodsPerWeek: Number(req.body.maxPeriodsPerWeek || 20),
      unavailable: req.body.unavailable || {},
      preferredOffPeriods: Array.isArray(req.body.preferredOffPeriods) ? req.body.preferredOffPeriods : []
    });
    return res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Teacher ID already exists" });
    return res.status(400).json({ error: "Failed to create teacher" });
  }
});

router.put("/:schoolId/:teacherId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const teacherId = req.params.teacherId;
  const update = {
    name: req.body.name,
    subjectIds: Array.isArray(req.body.subjectIds) ? req.body.subjectIds : [],
    classGroupIds: Array.isArray(req.body.classGroupIds) ? req.body.classGroupIds : [],
    level: req.body.level || "SENIOR",
    maxPeriodsPerWeek: Number(req.body.maxPeriodsPerWeek || 20),
    unavailable: req.body.unavailable || {},
    preferredOffPeriods: Array.isArray(req.body.preferredOffPeriods) ? req.body.preferredOffPeriods : []
  };
  const row = await Teacher.findOneAndUpdate({ schoolId, id: teacherId }, update, { new: true });
  if (!row) return res.status(404).json({ error: "Teacher not found" });
  return res.json(row);
});

router.delete("/:schoolId/:teacherId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const row = await Teacher.findOneAndDelete({ schoolId: req.params.schoolId, id: req.params.teacherId });
  if (!row) return res.status(404).json({ error: "Teacher not found" });
  return res.json({ message: "Deleted" });
});

module.exports = router;
