const express = require("express");
const { requireAuth, ensureSchoolAccess } = require("../middleware/auth");
const Subject = require("../models/Subject");
const Teacher = require("../models/Teacher");
const ClassGroup = require("../models/ClassGroup");

const router = express.Router();

router.get("/:schoolId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const [subjects, teachers, classes] = await Promise.all([
    Subject.find({ schoolId }).lean(),
    Teacher.find({ schoolId }).lean(),
    ClassGroup.find({ schoolId }).lean()
  ]);

  const subjectMap = {};
  const teacherMap = {};
  const classMap = {};

  for (const s of subjects) subjectMap[s.id] = s.name;
  for (const t of teachers) teacherMap[t.id] = t.name;
  for (const c of classes) classMap[c.id] = c.name;

  return res.json({
    subjects: subjectMap,
    teachers: teacherMap,
    classes: classMap
  });
});

module.exports = router;
