const express = require("express");
const PDFDocument = require("pdfkit");
const { requireAuth, ensureSchoolAccess } = require("../middleware/auth");
const TimetableSlot = require("../models/TimetableSlot");
const { DAY_ORDER } = require("../utils/timetable");

const router = express.Router();

function streamPdf(res, filename, draw) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  doc.pipe(res);
  draw(doc);
  doc.end();
}

function renderSimpleGrid(doc, slots, title) {
  doc.fontSize(16).text(title, { align: "left" });
  doc.moveDown();
  const grouped = {};
  for (const d of DAY_ORDER) grouped[d] = [];
  for (const s of slots) grouped[s.day].push(s);
  for (const d of DAY_ORDER) grouped[d].sort((a, b) => a.period - b.period);

  for (const day of DAY_ORDER) {
    doc.fontSize(12).text(day);
    if (!grouped[day].length) {
      doc.fontSize(10).fillColor("gray").text("  No periods").fillColor("black");
      doc.moveDown(0.3);
      continue;
    }
    for (const s of grouped[day]) {
      const line = `  P${s.period + 1}: ${s.subjectId} | Teacher: ${s.teacherId} | Class: ${s.classGroupId} ${s.sectionId}${s.labRoomId ? ` | Lab: ${s.labRoomId}` : ""}`;
      doc.fontSize(10).text(line);
    }
    doc.moveDown(0.5);
  }
}

router.get("/teacher/:schoolId/:teacherId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const { schoolId, teacherId } = req.params;
  if (req.user.role === "TEACHER" && req.user.teacherId !== teacherId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const slots = await TimetableSlot.find({ schoolId, teacherId }).sort({ day: 1, period: 1 }).lean();
  return streamPdf(res, `Teacher_${teacherId}.pdf`, (doc) => {
    renderSimpleGrid(doc, slots, `Teacher Timetable - ${teacherId}`);
  });
});

router.get("/class/:schoolId/:classId/:sectionId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const { schoolId, classId, sectionId } = req.params;
  const slots = await TimetableSlot.find({
    schoolId,
    classGroupId: classId,
    sectionId
  })
    .sort({ day: 1, period: 1 })
    .lean();

  return streamPdf(res, `Class_${classId}_${sectionId}.pdf`, (doc) => {
    renderSimpleGrid(doc, slots, `Class Timetable - ${classId} Section ${sectionId}`);
  });
});

module.exports = router;
