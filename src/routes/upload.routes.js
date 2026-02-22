const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const Teacher = require("../models/Teacher");
const Subject = require("../models/Subject");
const ClassGroup = require("../models/ClassGroup");
const LabRoom = require("../models/LabRoom");
const ClassSubject = require("../models/ClassSubject");
const { nextId } = require("../utils/id");
const { ensureClassSubjectMappings } = require("../services/autoMappings");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function sheetToRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function normalizeKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeRowKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    out[normalizeKey(k)] = v;
  }
  return out;
}

function csvToArray(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toBool(v) {
  const x = String(v || "").trim().toLowerCase();
  return x === "true" || x === "1" || x === "yes";
}

function normalizeRoomType(v) {
  const x = String(v || "CLASSROOM").trim().toUpperCase();
  if (x === "LAB") return "LAB";
  if (x === "LABROOM") return "LABROOM";
  if (x === "SPECIAL_ROOM") return "SPECIAL_ROOM";
  return "CLASSROOM";
}

function getVal(row, keys, fallback = "") {
  const nr = normalizeRowKeys(row);
  for (const k of keys) {
    const nk = normalizeKey(k);
    if (Object.prototype.hasOwnProperty.call(nr, nk)) return nr[nk];
  }
  return fallback;
}

function pickSheetName(sheetNames, candidates) {
  const set = new Set(sheetNames.map((s) => normalizeKey(s)));
  for (const c of candidates) {
    if (set.has(normalizeKey(c))) {
      const hit = sheetNames.find((s) => normalizeKey(s) === normalizeKey(c));
      if (hit) return hit;
    }
  }
  return null;
}

function romanToNumber(roman) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const s = String(roman || "").toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const cur = map[s[i]] || 0;
    const next = map[s[i + 1]] || 0;
    n += cur < next ? -cur : cur;
  }
  return n || null;
}

function classNumberFromSheetName(name) {
  const s = String(name || "");
  const digit = s.match(/(\d{1,2})/);
  if (digit) return Number(digit[1]);
  const roman = s.match(/\b([IVXLCDM]+)\b/i);
  if (roman) return romanToNumber(roman[1]);
  return null;
}

function classIdFromSheetName(name) {
  const num = classNumberFromSheetName(name);
  if (!num) return "";
  return `C${num}`;
}

function classNumberFromClassGroupId(id) {
  const m = String(id || "").match(/(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function classNumberFromClassGroupName(name) {
  return classNumberFromSheetName(name);
}

function periodsFromValue(v, fallback = 4) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function isLikelyHeaderRow(cells, requiredTokens) {
  const joined = normalizeKey(cells.join(" "));
  return requiredTokens.every((t) => joined.includes(normalizeKey(t)));
}

function extractCombinedTablesFromSheet(workbook, sheetName) {
  if (!sheetName) {
    return {
      teachersRows: [],
      classesRows: [],
      labRows: [],
      classSpecificRows: []
    };
  }

  const ws = workbook.Sheets[sheetName];
  if (!ws) {
    return {
      teachersRows: [],
      classesRows: [],
      labRows: [],
      classSpecificRows: []
    };
  }

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const teachersRows = [];
  const classesRows = [];
  const labRows = [];
  const classSpecificRows = [];

  let mode = "";
  let currentStdClassId = "";
  let stdHeaderReady = false;
  let tableHeaderReady = false;

  for (const rawRow of aoa) {
    const cells = (rawRow || []).map((c) => String(c || "").trim());
    if (!cells.some((c) => c)) continue;

    const joined = cells.join(" ");
    const joinedNorm = normalizeKey(joined);

    if (joinedNorm.includes("std")) {
      const classId = classIdFromSheetName(joined);
      if (classId) {
        mode = "std";
        currentStdClassId = classId;
        stdHeaderReady = false;
        continue;
      }
    }

    if (joinedNorm === "classes" || joinedNorm.startsWith("classesidname")) {
      mode = "classes";
      tableHeaderReady = joinedNorm.startsWith("classesidname");
      continue;
    }

    if (joinedNorm === "labrooms" || joinedNorm.startsWith("labroomsidname")) {
      mode = "labs";
      tableHeaderReady = joinedNorm.startsWith("labroomsidname");
      continue;
    }

    if (isLikelyHeaderRow(cells, ["id", "name", "subject", "class", "max", "week"])) {
      mode = "teachers";
      tableHeaderReady = true;
      continue;
    }

    if (mode === "std") {
      if (!stdHeaderReady && isLikelyHeaderRow(cells, ["id", "name", "periods", "room", "consecutive"])) {
        stdHeaderReady = true;
        continue;
      }
      if (!stdHeaderReady) continue;

      const id = cells[0] || "";
      const name = cells[1] || "";
      if (!id || !name) continue;
      if (!/^s\d+/i.test(id)) continue;

      classSpecificRows.push({
        classId: currentStdClassId,
        id,
        name,
        code: cells[2] || "",
        periodsPerWeek: cells[3] || "",
        roomType: cells[4] || "",
        requiresConsecutive: cells[5] || "",
        consecutiveSize: cells[6] || ""
      });
      continue;
    }

    if (mode === "teachers" && tableHeaderReady) {
      const id = cells[0] || "";
      const name = cells[1] || "";
      if (!id || !name) continue;
      if (!/^t\d+/i.test(id)) continue;
      teachersRows.push({
        id,
        name,
        subjectIds: cells[2] || "",
        classGroupIds: cells[3] || "",
        maxPeriodsPerWeek: cells[4] || ""
      });
      continue;
    }

    if (mode === "classes") {
      if (!tableHeaderReady && isLikelyHeaderRow(cells, ["id", "name", "sections", "subject"])) {
        tableHeaderReady = true;
        continue;
      }
      if (!tableHeaderReady) continue;
      const id = cells[0] || "";
      const name = cells[1] || "";
      if (!id || !name) continue;
      if (!/^c\d+/i.test(id)) continue;
      classesRows.push({
        id,
        name,
        sections: cells[2] || "",
        subjectIds: cells[3] || ""
      });
      continue;
    }

    if (mode === "labs") {
      if (!tableHeaderReady && isLikelyHeaderRow(cells, ["id", "name", "capacity"])) {
        tableHeaderReady = true;
        continue;
      }
      if (!tableHeaderReady) continue;
      const id = cells[0] || "";
      const name = cells[1] || "";
      if (!id || !name) continue;
      if (!/^l\d+/i.test(id)) continue;
      labRows.push({
        id,
        name,
        capacity: cells[2] || ""
      });
    }
  }

  return { teachersRows, classesRows, labRows, classSpecificRows };
}

router.post(
  "/:schoolId/master",
  requireAuth,
  requireRole("ADMIN"),
  ensureSchoolAccess,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Missing file" });

      const schoolId = req.params.schoolId;
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetNames = wb.SheetNames || [];

      const teachersSheet = pickSheetName(sheetNames, ["Teachers", "Teacher"]);
      const subjectsSheet = pickSheetName(sheetNames, ["Subjects", "Subject"]);
      const classesSheet = pickSheetName(sheetNames, ["Classes", "ClassGroups", "Class"]);
      const labsSheet = pickSheetName(sheetNames, ["LabRooms", "Labs", "Lab Room", "LabRooms"]);

      const teachersRows = teachersSheet ? sheetToRows(wb, teachersSheet) : [];
      const subjectsRows = subjectsSheet ? sheetToRows(wb, subjectsSheet) : [];
      const classesRows = classesSheet ? sheetToRows(wb, classesSheet) : [];
      const labRows = labsSheet ? sheetToRows(wb, labsSheet) : [];
      const combined = extractCombinedTablesFromSheet(wb, classesSheet);
      const combinedFromSubjects = extractCombinedTablesFromSheet(wb, subjectsSheet);
      const mergedTeachersRows = [...teachersRows, ...combined.teachersRows];
      const mergedClassesRows = [...classesRows, ...combined.classesRows];
      const mergedLabRows = [...labRows, ...combined.labRows];

      const classWiseSubjectSheets = sheetNames.filter((name) => {
        const n = normalizeKey(name);
        if (teachersSheet && normalizeKey(teachersSheet) === n) return false;
        if (subjectsSheet && normalizeKey(subjectsSheet) === n) return false;
        if (classesSheet && normalizeKey(classesSheet) === n) return false;
        if (labsSheet && normalizeKey(labsSheet) === n) return false;
        // Accept sheets like "STD - I", "Class 1", "Grade 2"
        return /std|class|grade|\d/.test(n);
      });

      const [existingTeachers, existingSubjects, existingClasses, existingLabs] = await Promise.all([
        Teacher.find({ schoolId }).select({ id: 1 }).lean(),
        Subject.find({ schoolId }).select({ id: 1 }).lean(),
        ClassGroup.find({ schoolId }).select({ id: 1 }).lean(),
        LabRoom.find({ schoolId }).select({ id: 1 }).lean()
      ]);

      let tCount = 0;
      let sCount = 0;
      let cCount = 0;
      let lCount = 0;
      const subjectIdsSeen = [...existingSubjects.map((x) => x.id)];
      const teacherIdsSeen = [...existingTeachers.map((x) => x.id)];
      const classIdsSeen = [...existingClasses.map((x) => x.id)];
      const labIdsSeen = [...existingLabs.map((x) => x.id)];
      const classSpecificSubjectPeriods = new Map();

      for (const row of subjectsRows) {
        const id = String(getVal(row, ["id", "subjectId"], "")).trim() || nextId("S", subjectIdsSeen);
        const name = String(getVal(row, ["name", "subjectName"], "")).trim();
        if (!name) continue;
        subjectIdsSeen.push(id);
        await Subject.findOneAndUpdate(
          { schoolId, id },
          {
            schoolId,
            id,
            name,
            code: String(getVal(row, ["code", "subjectCode"], "")).trim(),
            periodsPerWeek: periodsFromValue(getVal(row, ["periodsPerWeek", "periods/week", "weeklyPeriods"], 4), 4),
            requiresConsecutive: toBool(getVal(row, ["requiresConsecutive", "requires consecutive"], false)),
            consecutiveSize: periodsFromValue(getVal(row, ["consecutiveSize", "consecutive size"], 2), 2),
            roomType: normalizeRoomType(getVal(row, ["roomType", "room type"], "CLASSROOM")),
            teacherId: String(getVal(row, ["teacherId", "teacher"], "")).trim()
          },
          { upsert: true, new: true }
        );
        sCount += 1;
      }

      for (const row of mergedTeachersRows) {
        const id = String(getVal(row, ["teacherId", "id"], "")).trim() || nextId("T", teacherIdsSeen);
        const name = String(getVal(row, ["name", "teacherName"], "")).trim();
        if (!name) continue;
        teacherIdsSeen.push(id);
        await Teacher.findOneAndUpdate(
          { schoolId, id },
          {
            schoolId,
            id,
            name,
            subjectIds: csvToArray(getVal(row, ["subjectIds", "subject ids", "subjects"], "")),
            classGroupIds: csvToArray(getVal(row, ["classGroupIds", "class ids", "classIds"], "")),
            maxPeriodsPerWeek: periodsFromValue(getVal(row, ["maxPeriodsPerWeek", "max periods/week", "maxperiodsweek"], 20), 20)
          },
          { upsert: true, new: true }
        );
        tCount += 1;
      }

      for (const row of mergedClassesRows) {
        const id = String(getVal(row, ["id", "classId"], "")).trim() || nextId("C", classIdsSeen);
        const name = String(getVal(row, ["name", "className"], "")).trim();
        if (!name) continue;
        classIdsSeen.push(id);
        await ClassGroup.findOneAndUpdate(
          { schoolId, id },
          {
            schoolId,
            id,
            name,
            sections: csvToArray(getVal(row, ["sections", "sectionIds"], "")),
            subjectIds: csvToArray(getVal(row, ["subjectIds", "subject ids", "subjects"], ""))
          },
          { upsert: true, new: true }
        );
        cCount += 1;
      }

      // Parse class-wise subject definitions from extra sheets (e.g., "STD - I", "Class 3")
      for (const sName of classWiseSubjectSheets) {
        const classId = classIdFromSheetName(sName);
        if (!classId) continue;
        const rows = sheetToRows(wb, sName);
        for (const row of rows) {
          const subjectId = String(getVal(row, ["id", "subjectId"], "")).trim();
          const subjectName = String(getVal(row, ["name", "subjectName"], "")).trim();
          if (!subjectId || !subjectName) continue;

          if (!subjectIdsSeen.includes(subjectId)) {
            subjectIdsSeen.push(subjectId);
            await Subject.findOneAndUpdate(
              { schoolId, id: subjectId },
              {
                schoolId,
                id: subjectId,
                name: subjectName,
                code: String(getVal(row, ["code", "subjectCode"], "")).trim(),
                periodsPerWeek: periodsFromValue(getVal(row, ["periodsPerWeek", "periods/week", "weeklyPeriods"], 4), 4),
                requiresConsecutive: toBool(getVal(row, ["requiresConsecutive", "requires consecutive"], false)),
                consecutiveSize: periodsFromValue(getVal(row, ["consecutiveSize", "consecutive size"], 2), 2),
                roomType: normalizeRoomType(getVal(row, ["roomType", "room type"], "CLASSROOM")),
                teacherId: String(getVal(row, ["teacherId", "teacher"], "")).trim()
              },
              { upsert: true, new: true }
            );
            sCount += 1;
          }

          const periods = periodsFromValue(getVal(row, ["periodsPerWeek", "periods/week", "weeklyPeriods"], 4), 4);
          const requiresConsecutive = toBool(getVal(row, ["requiresConsecutive", "requires consecutive"], false));
          const consecutiveSize = periodsFromValue(getVal(row, ["consecutiveSize", "consecutive size"], 2), 2);
          const roomType = normalizeRoomType(getVal(row, ["roomType", "room type"], "CLASSROOM"));

          classSpecificSubjectPeriods.set(`${classId}::${subjectId}`, {
            classNumber: classNumberFromClassGroupId(classId),
            periodsPerWeek: periods,
            requiresConsecutive,
            consecutiveSize,
            roomType
          });
        }
      }

      for (const row of combined.classSpecificRows) {
        const classId = String(row.classId || "").trim();
        const subjectId = String(row.id || "").trim();
        const subjectName = String(row.name || "").trim();
        if (!classId || !subjectId || !subjectName) continue;

        if (!subjectIdsSeen.includes(subjectId)) {
          subjectIdsSeen.push(subjectId);
          await Subject.findOneAndUpdate(
            { schoolId, id: subjectId },
            {
              schoolId,
              id: subjectId,
              name: subjectName,
              code: String(row.code || "").trim(),
              periodsPerWeek: periodsFromValue(row.periodsPerWeek, 4),
              requiresConsecutive: toBool(row.requiresConsecutive),
              consecutiveSize: periodsFromValue(row.consecutiveSize, 2),
              roomType: normalizeRoomType(row.roomType),
              teacherId: ""
            },
            { upsert: true, new: true }
          );
          sCount += 1;
        }

        classSpecificSubjectPeriods.set(`${classId}::${subjectId}`, {
          classNumber: classNumberFromClassGroupId(classId),
          periodsPerWeek: periodsFromValue(row.periodsPerWeek, 4),
          requiresConsecutive: toBool(row.requiresConsecutive),
          consecutiveSize: periodsFromValue(row.consecutiveSize, 2),
          roomType: normalizeRoomType(row.roomType)
        });
      }

      // Support STD-wise subject blocks provided inside the Subjects sheet itself.
      for (const row of combinedFromSubjects.classSpecificRows) {
        const classId = String(row.classId || "").trim();
        const subjectId = String(row.id || "").trim();
        const subjectName = String(row.name || "").trim();
        if (!classId || !subjectId || !subjectName) continue;

        if (!subjectIdsSeen.includes(subjectId)) {
          subjectIdsSeen.push(subjectId);
          await Subject.findOneAndUpdate(
            { schoolId, id: subjectId },
            {
              schoolId,
              id: subjectId,
              name: subjectName,
              code: String(row.code || "").trim(),
              periodsPerWeek: periodsFromValue(row.periodsPerWeek, 4),
              requiresConsecutive: toBool(row.requiresConsecutive),
              consecutiveSize: periodsFromValue(row.consecutiveSize, 2),
              roomType: normalizeRoomType(row.roomType),
              teacherId: ""
            },
            { upsert: true, new: true }
          );
          sCount += 1;
        }

        classSpecificSubjectPeriods.set(`${classId}::${subjectId}`, {
          classNumber: classNumberFromClassGroupId(classId),
          periodsPerWeek: periodsFromValue(row.periodsPerWeek, 4),
          requiresConsecutive: toBool(row.requiresConsecutive),
          consecutiveSize: periodsFromValue(row.consecutiveSize, 2),
          roomType: normalizeRoomType(row.roomType)
        });
      }

      for (const row of mergedLabRows) {
        const id = String(getVal(row, ["id", "labId"], "")).trim() || nextId("L", labIdsSeen);
        const name = String(getVal(row, ["name", "labName"], "")).trim();
        if (!name) continue;
        labIdsSeen.push(id);
        await LabRoom.findOneAndUpdate(
          { schoolId, id },
          {
            schoolId,
            id,
            name,
            capacity: periodsFromValue(getVal(row, ["capacity"], 30), 30)
          },
          { upsert: true, new: true }
        );
        lCount += 1;
      }

      const autoMappings = await ensureClassSubjectMappings(schoolId);
      let classSpecificOverrides = 0;

      if (classSpecificSubjectPeriods.size > 0) {
        const classGroups = await ClassGroup.find({ schoolId }).select({ id: 1, name: 1 }).lean();
        for (const [k, cfg] of classSpecificSubjectPeriods.entries()) {
          const [classGroupIdCandidate, subjectId] = k.split("::");
          const targetClassIds = new Set();

          // 1) Exact class ID from parsed STD block.
          if (classGroupIdCandidate) {
            targetClassIds.add(classGroupIdCandidate);
          }

          // 2) Fallback by class number from actual class id/name (handles C01 vs C1 etc).
          if (cfg.classNumber) {
            for (const cg of classGroups) {
              const numFromId = classNumberFromClassGroupId(cg.id);
              const numFromName = classNumberFromClassGroupName(cg.name);
              if (numFromId === cfg.classNumber || numFromName === cfg.classNumber) {
                targetClassIds.add(cg.id);
              }
            }
          }

          for (const classGroupId of targetClassIds) {
            const updated = await ClassSubject.updateMany(
              { schoolId, classGroupId, subjectId },
              {
                $set: {
                  periodsPerWeek: cfg.periodsPerWeek,
                  roomType: cfg.roomType,
                  requiresConsecutive: cfg.requiresConsecutive,
                  consecutiveSize: cfg.consecutiveSize
                }
              }
            );
            classSpecificOverrides += Number(updated.matchedCount || 0);
          }
        }
      }

      return res.json({
        message: `Upload successful: Teachers=${tCount}, Subjects=${sCount}, Classes=${cCount}, Labs=${lCount}, AutoMappings=${autoMappings.created}, ClassSpecificOverrides=${classSpecificOverrides}`,
        autoMappingWarnings: autoMappings.warnings
      });
    } catch (e) {
      return res.status(400).json({ error: "Upload failed. Check sheet format and data." });
    }
  }
);

module.exports = router;
