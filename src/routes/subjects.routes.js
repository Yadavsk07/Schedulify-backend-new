const express = require("express");
const Subject = require("../models/Subject");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const { nextId } = require("../utils/id");

const router = express.Router();

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const rows = await Subject.find({ schoolId: req.params.schoolId }).sort({ name: 1 }).lean();
  return res.json(rows);
});

router.post("/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const existing = await Subject.find({ schoolId }).select({ id: 1 }).lean();
    const id = (req.body.id || "").trim() || nextId("S", existing.map((x) => x.id));
    const doc = await Subject.create({
      schoolId,
      id,
      name: req.body.name,
      code: req.body.code || "",
      periodsPerWeek: Number(req.body.periodsPerWeek || 4),
      requiresConsecutive: Boolean(req.body.requiresConsecutive),
      consecutiveSize: Number(req.body.consecutiveSize || 2),
      roomType: req.body.roomType || "CLASSROOM",
      teacherId: req.body.teacherId || ""
    });
    return res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Subject ID already exists" });
    return res.status(400).json({ error: "Failed to create subject" });
  }
});

router.put("/:schoolId/:subjectId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const subjectId = req.params.subjectId;
  const update = {
    name: req.body.name,
    code: req.body.code || "",
    periodsPerWeek: Number(req.body.periodsPerWeek || 4),
    requiresConsecutive: Boolean(req.body.requiresConsecutive),
    consecutiveSize: Number(req.body.consecutiveSize || 2),
    roomType: req.body.roomType || "CLASSROOM",
    teacherId: req.body.teacherId || ""
  };
  const row = await Subject.findOneAndUpdate({ schoolId, id: subjectId }, update, { new: true });
  if (!row) return res.status(404).json({ error: "Subject not found" });
  return res.json(row);
});

router.delete("/:schoolId/:subjectId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const row = await Subject.findOneAndDelete({ schoolId: req.params.schoolId, id: req.params.subjectId });
  if (!row) return res.status(404).json({ error: "Subject not found" });
  return res.json({ message: "Deleted" });
});

module.exports = router;
