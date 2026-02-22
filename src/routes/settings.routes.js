const express = require("express");
const SchoolSettings = require("../models/SchoolSettings");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const { normalizeDays } = require("../utils/timetable");

const router = express.Router();

function defaultsForSchool(schoolId) {
  return {
    schoolId,
    periodDuration: 45,
    periodsPerDay: 8,
    workingDays: 5,
    morningAssemblyPeriod: 0,
    startTime: "08:00",
    workingDayNames: normalizeDays(5),
    totalDaysPerWeek: 5,
    hasMorningAssembly: false,
    assemblySlot: 0,
    saturdayHalfDay: false
  };
}

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  let row = await SchoolSettings.findOne({ schoolId }).lean();
  if (!row) {
    row = await SchoolSettings.create(defaultsForSchool(schoolId));
    row = row.toObject();
  }
  return res.json(row);
});

router.put("/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const workingDays = Math.max(1, Math.min(6, Number(req.body.workingDays || 5)));
  const update = {
    periodDuration: Number(req.body.periodDuration || 45),
    periodsPerDay: Number(req.body.periodsPerDay || 8),
    workingDays,
    morningAssemblyPeriod: Number(req.body.morningAssemblyPeriod || 0),
    startTime: req.body.startTime || "08:00",
    workingDayNames: normalizeDays(workingDays),
    totalDaysPerWeek: workingDays,
    hasMorningAssembly: Number(req.body.morningAssemblyPeriod || 0) > 0,
    assemblySlot: Number(req.body.morningAssemblyPeriod || 0)
  };

  const row = await SchoolSettings.findOneAndUpdate({ schoolId }, update, {
    upsert: true,
    new: true
  });
  return res.json(row);
});

router.post("/:schoolId/reset", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const row = await SchoolSettings.findOneAndUpdate(
    { schoolId },
    defaultsForSchool(schoolId),
    { upsert: true, new: true }
  );
  return res.json(row);
});

module.exports = router;
