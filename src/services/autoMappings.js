const ClassGroup = require("../models/ClassGroup");
const ClassSubject = require("../models/ClassSubject");
const Subject = require("../models/Subject");
const Teacher = require("../models/Teacher");
const { nextId } = require("../utils/id");

function normalizeRoomType(v) {
  const x = String(v || "CLASSROOM").toUpperCase();
  if (x === "LABROOM") return "LABROOM";
  if (x === "LAB") return "LAB";
  if (x === "SPECIAL_ROOM") return "SPECIAL_ROOM";
  return "CLASSROOM";
}

function pickTeacherFor(classId, subjectId, teachers, currentAssignedCount, preferredTeacherId = "") {
  if (preferredTeacherId) {
    const preferred = teachers.find((t) => t.id === preferredTeacherId);
    if (preferred) {
      const hasSubject = (preferred.subjectIds || []).includes(subjectId);
      const allowedClass =
        !Array.isArray(preferred.classGroupIds) ||
        preferred.classGroupIds.length === 0 ||
        preferred.classGroupIds.includes(classId);
      if (hasSubject && allowedClass) {
        currentAssignedCount.set(preferred.id, (currentAssignedCount.get(preferred.id) || 0) + 1);
        return preferred.id;
      }
    }
  }

  const candidates = teachers.filter((t) => {
    const hasSubject = (t.subjectIds || []).includes(subjectId);
    const allowedClass = !Array.isArray(t.classGroupIds) || t.classGroupIds.length === 0 || t.classGroupIds.includes(classId);
    return hasSubject && allowedClass;
  });

  if (!candidates.length) return "";
  candidates.sort((a, b) => (currentAssignedCount.get(a.id) || 0) - (currentAssignedCount.get(b.id) || 0));
  const chosen = candidates[0].id;
  currentAssignedCount.set(chosen, (currentAssignedCount.get(chosen) || 0) + 1);
  return chosen;
}

async function ensureClassSubjectMappings(schoolId) {
  const [classes, subjects, teachers, existingMappings] = await Promise.all([
    ClassGroup.find({ schoolId }).lean(),
    Subject.find({ schoolId }).lean(),
    Teacher.find({ schoolId }).lean(),
    ClassSubject.find({ schoolId }).lean()
  ]);

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const mappingKeySet = new Set(existingMappings.map((m) => `${m.classGroupId}::${m.subjectId}`));
  const existingIds = existingMappings.map((m) => m.id);
  const assignedCount = new Map();
  for (const m of existingMappings) {
    if (m.teacherId) assignedCount.set(m.teacherId, (assignedCount.get(m.teacherId) || 0) + 1);
  }

  const toCreate = [];
  const warnings = [];

  for (const cls of classes) {
    const classSubjects = Array.isArray(cls.subjectIds) && cls.subjectIds.length
      ? cls.subjectIds
      : subjects.map((s) => s.id);

    for (const subjectId of classSubjects) {
      const key = `${cls.id}::${subjectId}`;
      if (mappingKeySet.has(key)) continue;

      const subject = subjectById.get(subjectId);
      if (!subject) {
        warnings.push(`Class ${cls.id} references unknown subject ${subjectId}`);
        continue;
      }

      const teacherId = pickTeacherFor(cls.id, subjectId, teachers, assignedCount, subject.teacherId || "");

      const id = nextId("CS", [...existingIds, ...toCreate.map((x) => x.id)]);
      toCreate.push({
        schoolId,
        id,
        classGroupId: cls.id,
        subjectId,
        teacherId,
        periodsPerWeek: Number(subject.periodsPerWeek || 4),
        roomType: normalizeRoomType(subject.roomType),
        requiresConsecutive: Boolean(subject.requiresConsecutive),
        consecutiveSize: Number(subject.consecutiveSize || 2)
      });
      mappingKeySet.add(key);
      if (!teacherId) warnings.push(`No teacher found for class ${cls.id}, subject ${subjectId}`);
    }
  }

  if (toCreate.length) await ClassSubject.insertMany(toCreate, { ordered: false });
  return { created: toCreate.length, warnings };
}

module.exports = { ensureClassSubjectMappings };
