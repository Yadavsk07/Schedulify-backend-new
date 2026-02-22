const express = require("express");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const Teacher = require("../models/Teacher");
const Subject = require("../models/Subject");
const ClassGroup = require("../models/ClassGroup");
const ClassSubject = require("../models/ClassSubject");
const LabRoom = require("../models/LabRoom");

const router = express.Router();

router.get("/stats/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;
  const [teachers, subjects, classes, classSubjects, labs] = await Promise.all([
    Teacher.countDocuments({ schoolId }),
    Subject.countDocuments({ schoolId }),
    ClassGroup.countDocuments({ schoolId }),
    ClassSubject.countDocuments({ schoolId }),
    LabRoom.countDocuments({ schoolId })
  ]);

  return res.json({ teachers, subjects, classes, classSubjects, labs });
});

module.exports = router;
