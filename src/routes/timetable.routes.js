const express = require("express");
const { stringify } = require("csv-stringify/sync");
const path = require("path");
const { spawn } = require("child_process");
const { requireAuth, requireRole, ensureSchoolAccess } = require("../middleware/auth");
const ClassGroup = require("../models/ClassGroup");
const ClassSubject = require("../models/ClassSubject");
const Teacher = require("../models/Teacher");
const LabRoom = require("../models/LabRoom");
const TimetableSlot = require("../models/TimetableSlot");
const SchoolSettings = require("../models/SchoolSettings");
const { groupSlots } = require("../utils/timetable");
const { ensureClassSubjectMappings } = require("../services/autoMappings");

const router = express.Router();

function getPeriodsForDay(days, periodsPerDay, saturdayHalfDay) {
  const out = {};
  for (const d of days) {
    out[d] = periodsPerDay;
  }
  if (saturdayHalfDay && days.includes("SAT")) {
    out.SAT = Math.max(1, Math.ceil(periodsPerDay / 2));
  }
  return out;
}

function getSchedulingDays() {
  return ["MON", "TUE", "WED", "THU", "FRI"];
}

function getTeacherPracticalSlots(teacher, settings, days, periodsPerDay) {
  const rawPeriodsByDay = getPeriodsForDay(days, periodsPerDay, false);
  const assemblySlot = Number(settings?.morningAssemblyPeriod ?? settings?.assemblySlot ?? -1);
  const hasAssembly = assemblySlot >= 0 && Boolean(settings?.hasMorningAssembly || settings?.morningAssemblyPeriod > 0);
  const unavailable = teacher?.unavailable || {};

  let availableSlots = 0;
  for (const day of days) {
    const raw = Number(rawPeriodsByDay[day] || periodsPerDay);
    const blockedSet = new Set((unavailable[day] || []).map((x) => Number(x)));
    if (hasAssembly && assemblySlot >= 0 && assemblySlot < raw) blockedSet.add(assemblySlot);
    availableSlots += Math.max(0, raw - blockedSet.size);
  }
  return availableSlots;
}

function isTeacherEligibleFor(teacher, classGroupId, subjectId, strictClassMatch = false) {
  const subjectOk =
    Array.isArray(teacher.subjectIds) && teacher.subjectIds.includes(subjectId);
  if (!subjectOk) return false;
  if (!strictClassMatch) return true;
  const classOk =
    !Array.isArray(teacher.classGroupIds) ||
    teacher.classGroupIds.length === 0 ||
    teacher.classGroupIds.includes(classGroupId);
  return classOk;
}

function allocateSectionRequirements({ classes, mappings, teachers, settings }) {
  const days = getSchedulingDays();
  const periodsPerDay = Number(settings?.periodsPerDay || 8);
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const teacherCap = new Map(
    teachers.map((t) => {
      const maxByConfig = Number(t.maxPeriodsPerWeek || 20);
      const practical = getTeacherPracticalSlots(t, settings, days, periodsPerDay);
      return [t.id, Math.min(maxByConfig, practical)];
    })
  );
  const teacherUsed = new Map(teachers.map((t) => [t.id, 0]));
  const mappingsByClass = new Map();
  for (const m of mappings) {
    if (!mappingsByClass.has(m.classGroupId)) mappingsByClass.set(m.classGroupId, []);
    mappingsByClass.get(m.classGroupId).push(m);
  }

  const requirements = [];
  const issues = [];
  const warnings = [];

  for (const cls of classes) {
    const sectionIds =
      Array.isArray(cls.sections) && cls.sections.length ? cls.sections : ["A"];
    const classMappings = mappingsByClass.get(cls.id) || [];

    for (const m of classMappings) {
      const weekly = Number(m.periodsPerWeek || 0);
      if (weekly <= 0) continue;

      const eligible = teachers.filter((t) =>
        isTeacherEligibleFor(t, cls.id, m.subjectId, false)
      );
      if (eligible.length === 0) {
        issues.push({
          type: "NO_ELIGIBLE_TEACHER",
          classGroupId: cls.id,
          subjectId: m.subjectId,
          detail: `No eligible teacher found for ${cls.id} subject ${m.subjectId}.`
        });
        continue;
      }

      for (const sectionId of sectionIds) {
        let chosen = null;

        // Prefer mapped teacher if eligible and has capacity.
        if (m.teacherId && teacherById.has(m.teacherId)) {
          const t = teacherById.get(m.teacherId);
          const cap = teacherCap.get(t.id) || 0;
          const used = teacherUsed.get(t.id) || 0;
          if (isTeacherEligibleFor(t, cls.id, m.subjectId, false) && used + weekly <= cap) {
            chosen = t;
          }
        }

        if (!chosen) {
          const withCapacity = eligible
            .filter((t) => (teacherUsed.get(t.id) || 0) + weekly <= (teacherCap.get(t.id) || 0))
            .sort((a, b) => {
              const aLoad = teacherUsed.get(a.id) || 0;
              const bLoad = teacherUsed.get(b.id) || 0;
              const aClassPref =
                Array.isArray(a.classGroupIds) && a.classGroupIds.includes(cls.id) ? 0 : 1;
              const bClassPref =
                Array.isArray(b.classGroupIds) && b.classGroupIds.includes(cls.id) ? 0 : 1;
              if (aClassPref !== bClassPref) return aClassPref - bClassPref;
              return aLoad - bLoad;
            });
          if (withCapacity.length > 0) {
            chosen = withCapacity[0];
          }
        }

        // If no teacher has free capacity, pick least loaded eligible and record overload issue.
        if (!chosen) {
          const sorted = [...eligible].sort(
            (a, b) => (teacherUsed.get(a.id) || 0) - (teacherUsed.get(b.id) || 0)
          );
          chosen = sorted[0];
          issues.push({
            type: "TEACHER_OVERLOAD_UNAVOIDABLE",
            classGroupId: cls.id,
            sectionId,
            subjectId: m.subjectId,
            teacherId: chosen.id,
            detail: `Insufficient teacher capacity for ${cls.id}-${sectionId} subject ${m.subjectId}; assigning ${chosen.id} exceeds capacity.`
          });
        }

        teacherUsed.set(chosen.id, (teacherUsed.get(chosen.id) || 0) + weekly);

        if (m.teacherId && m.teacherId !== chosen.id) {
          warnings.push({
            type: "TEACHER_REALLOCATED",
            classGroupId: cls.id,
            sectionId,
            subjectId: m.subjectId,
            fromTeacherId: m.teacherId,
            toTeacherId: chosen.id,
            detail: `Reallocated ${cls.id}-${sectionId} ${m.subjectId} from ${m.teacherId || "unassigned"} to ${chosen.id}.`
          });
        }

        requirements.push({
          classGroupId: cls.id,
          sectionId,
          subjectId: m.subjectId,
          teacherId: chosen.id,
          periodsPerWeek: weekly,
          roomType: m.roomType || "CLASSROOM",
          requiresConsecutive: Boolean(m.requiresConsecutive),
          consecutiveSize: Number(m.consecutiveSize || 2)
        });
      }
    }
  }

  return { requirements, issues, warnings, teacherUsed, teacherCap };
}

function runCpSatSolver(payload) {
  return new Promise((resolve) => {
    const scriptPath = path.resolve(__dirname, "../../scripts/cp_sat_timetable.py");
    const py = spawn("python", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";

    py.stdout.on("data", (d) => {
      out += d.toString();
    });
    py.stderr.on("data", (d) => {
      err += d.toString();
    });
    py.on("error", (e) => {
      resolve({ ok: false, error: `CP_SAT_SPAWN_ERROR:${e.message}` });
    });
    py.on("close", () => {
      if (err && !out) {
        resolve({ ok: false, error: `CP_SAT_RUNTIME_ERROR:${err}` });
        return;
      }
      try {
        const parsed = JSON.parse(out || "{}");
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: "CP_SAT_BAD_OUTPUT" });
      }
    });

    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

function runHeuristicSolver(payload) {
  const {
    days,
    periodsByDay,
    requirements,
    teachers,
    labIds
  } = payload;

  const teacherMax = new Map(teachers.map((t) => [t.id, Number(t.maxPeriodsPerWeek || 0)]));
  const teacherUnavailable = new Map(teachers.map((t) => [t.id, t.unavailable || {}]));
  const teacherLoad = new Map(teachers.map((t) => [t.id, 0]));

  const classBusy = new Set();
  const teacherBusy = new Set();
  const labBusy = new Set();
  const slots = [];
  const unscheduled = [];

  const ordered = [...requirements].sort((a, b) => {
    const aBlock = a.requiresConsecutive ? Math.max(2, Number(a.consecutiveSize || 2)) : 1;
    const bBlock = b.requiresConsecutive ? Math.max(2, Number(b.consecutiveSize || 2)) : 1;
    if (bBlock !== aBlock) return bBlock - aBlock;
    return Number(b.periodsPerWeek || 0) - Number(a.periodsPerWeek || 0);
  });

  const pickLab = (day, period) => {
    for (const lab of labIds) {
      if (!labBusy.has(`${lab}|${day}|${period}`)) return lab;
    }
    return "";
  };

  for (const req of ordered) {
    const tId = req.teacherId;
    const total = Number(req.periodsPerWeek || 0);
    const block = req.requiresConsecutive ? Math.max(2, Number(req.consecutiveSize || 2)) : 1;
    const needsLab = ["LAB", "LABROOM"].includes(String(req.roomType || "").toUpperCase());
    let remaining = total;

    const tryPlaceBlock = (size) => {
      for (const day of days) {
        const maxP = Number(periodsByDay[day] || 0);
        for (let start = 0; start + size <= maxP; start += 1) {
          let ok = true;
          const placements = [];
          for (let p = start; p < start + size; p += 1) {
            if (classBusy.has(`${req.classGroupId}|${req.sectionId}|${day}|${p}`)) {
              ok = false;
              break;
            }
            if (teacherBusy.has(`${tId}|${day}|${p}`)) {
              ok = false;
              break;
            }
            if ((teacherUnavailable.get(tId)?.[day] || []).includes(p)) {
              ok = false;
              break;
            }
            const current = teacherLoad.get(tId) || 0;
            const cap = teacherMax.get(tId) || 0;
            if (current + size > cap) {
              ok = false;
              break;
            }
            let labRoomId = "";
            if (needsLab) {
              labRoomId = pickLab(day, p);
              if (!labRoomId) {
                ok = false;
                break;
              }
            }
            placements.push({ day, period: p, labRoomId });
          }
          if (!ok) continue;

          for (const s of placements) {
            classBusy.add(`${req.classGroupId}|${req.sectionId}|${s.day}|${s.period}`);
            teacherBusy.add(`${tId}|${s.day}|${s.period}`);
            if (s.labRoomId) labBusy.add(`${s.labRoomId}|${s.day}|${s.period}`);
            slots.push({
              classGroupId: req.classGroupId,
              sectionId: req.sectionId,
              day: s.day,
              period: s.period,
              subjectId: req.subjectId,
              teacherId: tId,
              labRoomId: s.labRoomId || "",
              roomType: req.roomType || "CLASSROOM"
            });
          }
          teacherLoad.set(tId, (teacherLoad.get(tId) || 0) + size);
          return true;
        }
      }
      return false;
    };

    while (remaining > 0) {
      let size = block;
      if (remaining < size) size = 1;
      if (!tryPlaceBlock(size)) break;
      remaining -= size;
    }

    if (remaining > 0) {
      unscheduled.push({
        classGroupId: req.classGroupId,
        sectionId: req.sectionId,
        subjectId: req.subjectId,
        teacherId: req.teacherId,
        remaining
      });
    }
  }

  return {
    ok: unscheduled.length === 0,
    slots,
    unscheduled
  };
}

function buildValidationReport({ classes, mappings, teachers, settings, labs }) {
  const days = getSchedulingDays();
  const periodsPerDay = Number(settings?.periodsPerDay || 8);
  const rawPeriodsByDay = getPeriodsForDay(days, periodsPerDay, false);
  const assemblySlot = Number(settings?.morningAssemblyPeriod ?? settings?.assemblySlot ?? -1);
  const hasAssembly = assemblySlot >= 0 && Boolean(settings?.hasMorningAssembly || settings?.morningAssemblyPeriod > 0);
  const periodsByDay = {};
  for (const d of days) {
    const raw = Number(rawPeriodsByDay[d] || periodsPerDay);
    const assemblyCut =
      hasAssembly && assemblySlot >= 0 && assemblySlot < raw ? 1 : 0;
    periodsByDay[d] = Math.max(0, raw - assemblyCut);
  }
  const totalWeekSlotsPerSection = days.reduce(
    (sum, d) => sum + Number(periodsByDay[d] || periodsPerDay),
    0
  );
  const maxDaySlots = Math.max(...days.map((d) => Number(periodsByDay[d] || periodsPerDay)));

  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const allocation = allocateSectionRequirements({ classes, mappings, teachers, settings });
  const requirements = allocation.requirements;

  const issues = [...allocation.issues];
  const warnings = [...allocation.warnings];
  const metrics = {
    classSections: {},
    classWeeklyDemand: {},
    teacherWeeklyDemand: {},
    teacherWeeklyCapacity: {},
    totalLabDemand: 0,
    totalLabCapacity: labs.length * totalWeekSlotsPerSection
  };

  let totalSchoolDemand = 0;

  for (const cls of classes) {
    const sections = Array.isArray(cls.sections) && cls.sections.length ? cls.sections : ["A"];
    const sectionCount = sections.length;
    const classRequirements = requirements.filter((r) => r.classGroupId === cls.id);

    metrics.classSections[cls.id] = sectionCount;

    const bySection = new Map();
    for (const r of classRequirements) {
      const k = `${r.classGroupId}::${r.sectionId}`;
      bySection.set(k, (bySection.get(k) || 0) + Number(r.periodsPerWeek || 0));
    }
    const weeklyPerSection = bySection.size > 0 ? Math.max(...bySection.values()) : 0;
    const weeklyPerClassAllSections = weeklyPerSection * sectionCount;
    metrics.classWeeklyDemand[cls.id] = weeklyPerSection;
    totalSchoolDemand += weeklyPerClassAllSections;

    if (weeklyPerSection > totalWeekSlotsPerSection) {
      issues.push({
        type: "CLASS_OVER_CAPACITY",
        classGroupId: cls.id,
        className: cls.name,
        demandPerSection: weeklyPerSection,
        availablePerSection: totalWeekSlotsPerSection,
        shortage: weeklyPerSection - totalWeekSlotsPerSection,
        detail: `Class ${cls.id} requires ${weeklyPerSection} periods/section but only ${totalWeekSlotsPerSection} slots are available.`
      });
    }
    if (weeklyPerSection < totalWeekSlotsPerSection) {
      warnings.push({
        type: "CLASS_UNDER_CAPACITY",
        classGroupId: cls.id,
        className: cls.name,
        demandPerSection: weeklyPerSection,
        availablePerSection: totalWeekSlotsPerSection,
        freePeriodsPerSection: totalWeekSlotsPerSection - weeklyPerSection,
        detail: `Class ${cls.id} has ${totalWeekSlotsPerSection - weeklyPerSection} free periods/section by design.`
      });
    }

    for (const r of classRequirements) {
      const weekly = Number(r.periodsPerWeek || 0);
      const teacherId = r.teacherId || "";

      if (!teacherId) {
        issues.push({
          type: "UNASSIGNED_TEACHER",
          classGroupId: cls.id,
          subjectId: r.subjectId,
          detail: `No teacher assigned for ${cls.id} subject ${r.subjectId}.`
        });
      } else if (!teacherById.has(teacherId)) {
        issues.push({
          type: "INVALID_TEACHER",
          classGroupId: cls.id,
          subjectId: r.subjectId,
          teacherId,
          detail: `Teacher ${teacherId} assigned to ${cls.id} subject ${r.subjectId} does not exist.`
        });
      } else {
        metrics.teacherWeeklyDemand[teacherId] =
          Number(metrics.teacherWeeklyDemand[teacherId] || 0) + weekly;
      }

      if (["LAB", "LABROOM"].includes(String(r.roomType || "").toUpperCase())) {
        metrics.totalLabDemand += weekly;
      }

      if (Boolean(r.requiresConsecutive)) {
        const block = Math.max(2, Number(r.consecutiveSize || 2));
        if (block > maxDaySlots) {
          issues.push({
            type: "CONSECUTIVE_IMPOSSIBLE",
            classGroupId: cls.id,
            subjectId: r.subjectId,
            consecutiveSize: block,
            maxDaySlots,
            detail: `Consecutive size ${block} cannot fit in day max ${maxDaySlots} for ${cls.id} subject ${r.subjectId}.`
          });
        }
      }
    }
  }

  for (const t of teachers) {
    const cap = Number(allocation.teacherCap.get(t.id) || 0);
    const demand = Number(allocation.teacherUsed.get(t.id) || metrics.teacherWeeklyDemand[t.id] || 0);
    metrics.teacherWeeklyCapacity[t.id] = cap;
    if (demand > cap) {
      issues.push({
        type: "TEACHER_OVERLOAD",
        teacherId: t.id,
        teacherName: t.name,
        demand,
        capacity: cap,
        shortage: demand - cap,
        detail: `Teacher ${t.id} demand ${demand} exceeds weekly capacity ${cap}.`
      });
    }

    // Available slots after assembly + declared unavailability.
    const availableSlots = getTeacherPracticalSlots(t, settings, days, periodsPerDay);
    if (demand > availableSlots) {
      issues.push({
        type: "TEACHER_AVAILABLE_SLOT_SHORTAGE",
        teacherId: t.id,
        teacherName: t.name,
        demand,
        availableSlots,
        shortage: demand - availableSlots,
        detail: `Teacher ${t.id} demand ${demand} exceeds practical available slots ${availableSlots} after unavailability/assembly.`
      });
    }
  }

  if (metrics.totalLabDemand > metrics.totalLabCapacity) {
    issues.push({
      type: "LAB_CAPACITY_SHORTAGE",
      demand: metrics.totalLabDemand,
      capacity: metrics.totalLabCapacity,
      shortage: metrics.totalLabDemand - metrics.totalLabCapacity,
      labRooms: labs.length,
      detail: `Total LAB demand ${metrics.totalLabDemand} exceeds lab capacity ${metrics.totalLabCapacity}.`
    });
  }

  const totalSectionCount = classes.reduce((sum, c) => {
    const count = Array.isArray(c.sections) && c.sections.length ? c.sections.length : 1;
    return sum + count;
  }, 0);
  const totalSchoolCapacity = totalSectionCount * totalWeekSlotsPerSection;
  if (totalSchoolDemand > totalSchoolCapacity) {
    issues.push({
      type: "SCHOOL_OVER_CAPACITY",
      demand: totalSchoolDemand,
      capacity: totalSchoolCapacity,
      shortage: totalSchoolDemand - totalSchoolCapacity,
      detail: `Total school demand ${totalSchoolDemand} exceeds total section capacity ${totalSchoolCapacity}.`
    });
  }

  // Consecutive feasibility under teacher unavailability + assembly at least once in the week.
  for (const cls of classes) {
    const classRequirements = requirements.filter((r) => r.classGroupId === cls.id);
    for (const r of classRequirements) {
      if (!Boolean(r.requiresConsecutive)) continue;
      const teacherId = r.teacherId || "";
      const t = teacherById.get(teacherId);
      if (!teacherId || !t) continue;
      const block = Math.max(2, Number(r.consecutiveSize || 2));
      let hasAnyBlock = false;
      for (const day of days) {
        const raw = Number(rawPeriodsByDay[day] || periodsPerDay);
        const blocked = new Set((t.unavailable?.[day] || []).map((x) => Number(x)));
        if (hasAssembly && assemblySlot >= 0 && assemblySlot < raw) blocked.add(assemblySlot);
        for (let start = 0; start + block <= raw; start += 1) {
          let ok = true;
          for (let p = start; p < start + block; p += 1) {
            if (blocked.has(p)) {
              ok = false;
              break;
            }
          }
          if (ok) {
            hasAnyBlock = true;
            break;
          }
        }
        if (hasAnyBlock) break;
      }
      if (!hasAnyBlock) {
        issues.push({
          type: "CONSECUTIVE_NO_FEASIBLE_WINDOW",
          classGroupId: cls.id,
          subjectId: r.subjectId,
          teacherId,
          consecutiveSize: block,
          detail: `No feasible consecutive window of size ${block} exists for teacher ${teacherId} on any day.`
        });
      }
    }
  }

  return {
    feasible: issues.length === 0,
    summary: {
      issueCount: issues.length,
      warningCount: warnings.length,
      classes: classes.length,
      mappings: mappings.length,
      teachers: teachers.length,
      labRooms: labs.length,
      days,
      hasAssembly,
      assemblySlot,
      rawPeriodsByDay,
      periodsByDay,
      totalWeekSlotsPerSection
    },
    allocationSummary: {
      reallocatedCount: warnings.filter((w) => w.type === "TEACHER_REALLOCATED").length
    },
    issues,
    warnings,
    metrics
  };
}

router.get("/validate/school/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;

  const [classes, mappings, teachers, settings, labs] = await Promise.all([
    ClassGroup.find({ schoolId }).lean(),
    ClassSubject.find({ schoolId }).lean(),
    Teacher.find({ schoolId }).lean(),
    SchoolSettings.findOne({ schoolId }).lean(),
    LabRoom.find({ schoolId }).lean()
  ]);

  const report = buildValidationReport({ classes, mappings, teachers, settings, labs });
  return res.json(report);
});

router.post("/generate/school/:schoolId", requireAuth, requireRole("ADMIN"), ensureSchoolAccess, async (req, res) => {
  const schoolId = req.params.schoolId;

  const autoMapResult = await ensureClassSubjectMappings(schoolId);

  const [classes, mappings, teachers, labs, settings] = await Promise.all([
    ClassGroup.find({ schoolId }).lean(),
    ClassSubject.find({ schoolId }).lean(),
    Teacher.find({ schoolId }).lean(),
    LabRoom.find({ schoolId }).lean(),
    SchoolSettings.findOne({ schoolId }).lean()
  ]);

  const days = getSchedulingDays();
  const periodsPerDay = Number(settings?.periodsPerDay || 8);
  const periodsByDay = getPeriodsForDay(days, periodsPerDay, false);
  const assemblySlot = Number(settings?.morningAssemblyPeriod || settings?.assemblySlot || -1);
  const hasAssembly = assemblySlot >= 0 && Boolean(settings?.hasMorningAssembly || settings?.morningAssemblyPeriod > 0);

  if (!classes.length) return res.status(400).json({ error: "No classes found" });
  if (!mappings.length) return res.status(400).json({ error: "No class-subject mappings found" });

  const validation = buildValidationReport({ classes, mappings, teachers, settings, labs });
  if (!validation.feasible) {
    return res.status(422).json({
      error: "Timetable cannot be generated due to feasibility constraints.",
      reason: "Resolve the listed issues and try again.",
      validation
    });
  }

  // Primary solver: CP-SAT (OR-Tools)
  const allocation = allocateSectionRequirements({ classes, mappings, teachers, settings });
  const cpSatInput = {
    days,
    periodsByDay,
    hasAssembly,
    assemblySlot,
    classes: classes.map((c) => ({
      id: c.id,
      sections: Array.isArray(c.sections) && c.sections.length ? c.sections : ["A"]
    })),
    requirements: allocation.requirements,
    teachers: teachers.map((t) => ({
      id: t.id,
      maxPeriodsPerWeek: Number(allocation.teacherCap.get(t.id) || 0),
      unavailable: t.unavailable || {}
    })),
    labIds: labs.map((l) => l.id),
    timeLimitSec: Number(process.env.CP_SAT_TIME_LIMIT_SEC || 25)
  };
  const enableCpSat = String(process.env.ENABLE_CP_SAT || "false").toLowerCase() === "true";

  if (enableCpSat) {
    const cpSat = await runCpSatSolver(cpSatInput);
    if (cpSat?.ok && Array.isArray(cpSat.slots)) {
      await TimetableSlot.deleteMany({ schoolId });
      const docs = cpSat.slots.map((s) => ({
        schoolId,
        classGroupId: s.classGroupId,
        sectionId: s.sectionId,
        day: s.day,
        period: Number(s.period),
        subjectId: s.subjectId,
        teacherId: s.teacherId,
        labRoomId: s.labRoomId || "",
        roomType: s.roomType || "CLASSROOM",
        locked: false
      }));
      if (docs.length) await TimetableSlot.insertMany(docs, { ordered: false });
      return res.json({
        message: `Timetable generated using CP-SAT. Slots: ${docs.length}.`,
        solver: "CP-SAT",
        autoMappingsCreated: autoMapResult.created,
        warnings: Array.from(new Set([...(autoMapResult.warnings || []), ...((cpSat.warnings || []))]))
      });
    }
  }

  const heuristic = runHeuristicSolver(cpSatInput);
  if (!heuristic.ok) {
    return res.status(422).json({
      error: "Timetable generation failed.",
      reason: "No complete feasible schedule could be generated with current constraints.",
      validation,
      unscheduled: heuristic.unscheduled.slice(0, 50)
    });
  }

  await TimetableSlot.deleteMany({ schoolId });
  const docs = heuristic.slots.map((s) => ({
    schoolId,
    classGroupId: s.classGroupId,
    sectionId: s.sectionId,
    day: s.day,
    period: Number(s.period),
    subjectId: s.subjectId,
    teacherId: s.teacherId,
    labRoomId: s.labRoomId || "",
    roomType: s.roomType || "CLASSROOM",
    locked: false
  }));
  if (docs.length) await TimetableSlot.insertMany(docs, { ordered: false });
  return res.json({
    message: `Timetable generated using heuristic solver. Slots: ${docs.length}.`,
    solver: "Heuristic",
    autoMappingsCreated: autoMapResult.created,
    warnings: autoMapResult.warnings || []
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

  return res.json({ timetable: groupSlots(slots) });
});

router.get("/teacher/:schoolId/:teacherId", requireAuth, ensureSchoolAccess, async (req, res) => {
  const { schoolId, teacherId } = req.params;
  if (req.user.role === "TEACHER" && req.user.teacherId !== teacherId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const slots = await TimetableSlot.find({ schoolId, teacherId }).sort({ day: 1, period: 1 }).lean();
  return res.json({ timetable: groupSlots(slots) });
});

router.get("/teacher/:schoolId/:teacherId/csv", requireAuth, ensureSchoolAccess, async (req, res) => {
  const { schoolId, teacherId } = req.params;
  if (req.user.role === "TEACHER" && req.user.teacherId !== teacherId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const slots = await TimetableSlot.find({ schoolId, teacherId }).sort({ day: 1, period: 1 }).lean();
  const csv = stringify(
    slots.map((s) => ({
      day: s.day,
      period: s.period + 1,
      classGroupId: s.classGroupId,
      sectionId: s.sectionId,
      subjectId: s.subjectId,
      teacherId: s.teacherId,
      labRoomId: s.labRoomId || ""
    })),
    { header: true }
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=Teacher_${teacherId}.csv`);
  return res.send(csv);
});

module.exports = router;
