const express = require("express");
const ClassGroup = require("../models/ClassGroup");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const { nextId } = require("../utils/id");

const router = express.Router();

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const rows = await ClassGroup.find({ schoolId: req.params.schoolId }).sort({ name: 1 }).lean();
  return res.json(rows);
});

router.get("/:schoolId/:classId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const row = await ClassGroup.findOne({
    schoolId: req.params.schoolId,
    id: req.params.classId
  }).lean();
  if (!row) return res.status(404).json({ error: "Class not found" });
  return res.json(row);
});

router.post("/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const existing = await ClassGroup.find({ schoolId }).select({ id: 1 }).lean();
    const id = (req.body.id || "").trim() || nextId("C", existing.map((x) => x.id));
    const doc = await ClassGroup.create({
      schoolId,
      id,
      name: req.body.name,
      sections: Array.isArray(req.body.sectionIds || req.body.sections)
        ? (req.body.sectionIds || req.body.sections)
        : [],
      subjectIds: Array.isArray(req.body.subjectIds) ? req.body.subjectIds : []
    });
    return res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Class ID already exists" });
    return res.status(400).json({ error: "Failed to create class" });
  }
});

router.put("/:schoolId/:classId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const classId = req.params.classId;
  const update = {
    name: req.body.name,
    sections: Array.isArray(req.body.sectionIds || req.body.sections)
      ? (req.body.sectionIds || req.body.sections)
      : [],
    subjectIds: Array.isArray(req.body.subjectIds) ? req.body.subjectIds : []
  };
  const row = await ClassGroup.findOneAndUpdate({ schoolId, id: classId }, update, { new: true });
  if (!row) return res.status(404).json({ error: "Class not found" });
  return res.json(row);
});

router.delete("/:schoolId/:classId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const row = await ClassGroup.findOneAndDelete({ schoolId: req.params.schoolId, id: req.params.classId });
  if (!row) return res.status(404).json({ error: "Class not found" });
  return res.json({ message: "Deleted" });
});

module.exports = router;
