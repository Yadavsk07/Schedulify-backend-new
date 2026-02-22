const express = require("express");
const ClassSubject = require("../models/ClassSubject");
const Subject = require("../models/Subject");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const { nextId } = require("../utils/id");

const router = express.Router();

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const rows = await ClassSubject.find({ schoolId: req.params.schoolId })
    .sort({ classGroupId: 1, subjectId: 1, teacherId: 1 })
    .lean();
  return res.json(rows);
});

router.post("/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const existing = await ClassSubject.find({ schoolId }).select({ id: 1 }).lean();
    const id = (req.body.id || "").trim() || nextId("CS", existing.map((x) => x.id));

    let roomType = req.body.roomType || "CLASSROOM";
    if (req.body.subjectId) {
      const sub = await Subject.findOne({ schoolId, id: req.body.subjectId }).lean();
      if (sub?.roomType && !req.body.roomType) roomType = sub.roomType;
    }

    const doc = await ClassSubject.create({
      schoolId,
      id,
      classGroupId: req.body.classGroupId,
      subjectId: req.body.subjectId,
      teacherId: req.body.teacherId || "",
      periodsPerWeek: Number(req.body.periodsPerWeek || 4),
      roomType,
      requiresConsecutive: Boolean(req.body.requiresConsecutive),
      consecutiveSize: Number(req.body.consecutiveSize || 2)
    });
    return res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Mapping ID already exists" });
    return res.status(400).json({ error: "Failed to create class-subject mapping" });
  }
});

router.put("/:schoolId/:mappingId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const mappingId = req.params.mappingId;

  let roomType = req.body.roomType || "CLASSROOM";
  if (req.body.subjectId && !req.body.roomType) {
    const sub = await Subject.findOne({ schoolId, id: req.body.subjectId }).lean();
    if (sub?.roomType) roomType = sub.roomType;
  }

  const update = {
    classGroupId: req.body.classGroupId,
    subjectId: req.body.subjectId,
    teacherId: req.body.teacherId || "",
    periodsPerWeek: Number(req.body.periodsPerWeek || 4),
    roomType,
    requiresConsecutive: Boolean(req.body.requiresConsecutive),
    consecutiveSize: Number(req.body.consecutiveSize || 2)
  };

  let row = await ClassSubject.findOneAndUpdate({ schoolId, id: mappingId }, update, { new: true });
  if (!row) {
    row = await ClassSubject.findOneAndUpdate({ schoolId, _id: mappingId }, update, { new: true });
  }
  if (!row) return res.status(404).json({ error: "Mapping not found" });
  return res.json(row);
});

router.delete("/:schoolId/:mappingId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const row = await ClassSubject.findOneAndDelete({ schoolId: req.params.schoolId, id: req.params.mappingId });
  if (!row) {
    const fallback = await ClassSubject.findOneAndDelete({ schoolId: req.params.schoolId, _id: req.params.mappingId });
    if (!fallback) return res.status(404).json({ error: "Mapping not found" });
  }
  return res.json({ message: "Deleted" });
});

module.exports = router;
