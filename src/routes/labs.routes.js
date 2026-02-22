const express = require("express");
const LabRoom = require("../models/LabRoom");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const { nextId } = require("../utils/id");

const router = express.Router();

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const rows = await LabRoom.find({ schoolId: req.params.schoolId }).sort({ name: 1 }).lean();
  return res.json(rows);
});

router.post("/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const existing = await LabRoom.find({ schoolId }).select({ id: 1 }).lean();
    const id = (req.body.id || "").trim() || nextId("L", existing.map((x) => x.id));
    const doc = await LabRoom.create({
      schoolId,
      id,
      name: req.body.name,
      subjectType: req.body.subjectType || "",
      capacity: Number(req.body.capacity || 30)
    });
    return res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Lab ID already exists" });
    return res.status(400).json({ error: "Failed to create lab room" });
  }
});

router.put("/:schoolId/:labId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const row = await LabRoom.findOneAndUpdate(
    { schoolId: req.params.schoolId, id: req.params.labId },
    {
      name: req.body.name,
      subjectType: req.body.subjectType || "",
      capacity: Number(req.body.capacity || 30)
    },
    { new: true }
  );
  if (!row) return res.status(404).json({ error: "Lab room not found" });
  return res.json(row);
});

router.delete("/:schoolId/:labId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const row = await LabRoom.findOneAndDelete({ schoolId: req.params.schoolId, id: req.params.labId });
  if (!row) return res.status(404).json({ error: "Lab room not found" });
  return res.json({ message: "Deleted" });
});

module.exports = router;
