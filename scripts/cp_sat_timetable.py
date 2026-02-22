import json
import sys
from collections import defaultdict

try:
    from ortools.sat.python import cp_model
except Exception:
    print(json.dumps({"ok": False, "error": "ORTOOLS_NOT_INSTALLED"}))
    sys.exit(0)


def slot_key(day, period):
    return f"{day}|{period}"


def build_sections(classes):
    out = []
    for c in classes:
        secs = c.get("sections") or []
        if not secs:
            secs = ["A"]
        for s in secs:
            out.append({"classGroupId": c["id"], "sectionId": s})
    return out


def main():
    payload = json.load(sys.stdin)
    days = payload["days"]
    periods_by_day = payload["periodsByDay"]
    has_assembly = bool(payload.get("hasAssembly", False))
    assembly_slot = int(payload.get("assemblySlot", -1))
    mappings = payload.get("mappings", [])
    requirements_input = payload.get("requirements", [])
    classes = payload["classes"]
    teachers = payload["teachers"]
    lab_ids = payload["labIds"]

    sections = build_sections(classes)
    teacher_unavail = {t["id"]: t.get("unavailable", {}) for t in teachers}
    teacher_max = {t["id"]: int(t.get("maxPeriodsPerWeek", 20)) for t in teachers}

    # Expand demand into sessions:
    # - consecutive blocks
    # - remaining singles
    reqs = []

    def append_from_entry(entry):
        demand = int(entry.get("periodsPerWeek", 0))
        if demand <= 0:
            return
        block = 1
        if entry.get("requiresConsecutive"):
            block = max(2, int(entry.get("consecutiveSize", 2)))
        if block > 1:
            full_blocks = demand // block
            rem = demand % block
            for _ in range(full_blocks):
                reqs.append(
                    {
                        "type": "block",
                        "size": block,
                        "classGroupId": entry["classGroupId"],
                        "sectionId": entry["sectionId"],
                        "subjectId": entry["subjectId"],
                        "teacherId": entry.get("teacherId") or "",
                        "roomType": entry.get("roomType", "CLASSROOM"),
                    }
                )
            for _ in range(rem):
                reqs.append(
                    {
                        "type": "single",
                        "size": 1,
                        "classGroupId": entry["classGroupId"],
                        "sectionId": entry["sectionId"],
                        "subjectId": entry["subjectId"],
                        "teacherId": entry.get("teacherId") or "",
                        "roomType": entry.get("roomType", "CLASSROOM"),
                    }
                )
        else:
            for _ in range(demand):
                reqs.append(
                    {
                        "type": "single",
                        "size": 1,
                        "classGroupId": entry["classGroupId"],
                        "sectionId": entry["sectionId"],
                        "subjectId": entry["subjectId"],
                        "teacherId": entry.get("teacherId") or "",
                        "roomType": entry.get("roomType", "CLASSROOM"),
                    }
                )

    if requirements_input:
        for r in requirements_input:
            if not r.get("classGroupId") or not r.get("sectionId") or not r.get("subjectId"):
                continue
            append_from_entry(r)
    else:
        for sec in sections:
            for m in mappings:
                if m["classGroupId"] != sec["classGroupId"]:
                    continue
                entry = {
                    "classGroupId": sec["classGroupId"],
                    "sectionId": sec["sectionId"],
                    "subjectId": m["subjectId"],
                    "teacherId": m.get("teacherId") or "",
                    "periodsPerWeek": m.get("periodsPerWeek", 0),
                    "roomType": m.get("roomType", "CLASSROOM"),
                    "requiresConsecutive": m.get("requiresConsecutive", False),
                    "consecutiveSize": m.get("consecutiveSize", 2),
                }
                append_from_entry(entry)

    # Fast invalid checks
    teacher_ids = set(t["id"] for t in teachers)
    for r in reqs:
        if not r["teacherId"] or r["teacherId"] not in teacher_ids:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": f"INVALID_OR_MISSING_TEACHER:{r['classGroupId']}:{r['subjectId']}",
                    }
                )
            )
            return

    model = cp_model.CpModel()
    req_placement_vars = defaultdict(list)
    # slot occupancy expressions
    class_slot_vars = defaultdict(list)
    teacher_slot_vars = defaultdict(list)
    lab_slot_vars = defaultdict(list)
    teacher_weekly_vars = defaultdict(list)

    # Build placement variables per requirement
    for rid, r in enumerate(reqs):
        teacher = r["teacherId"]
        needs_lab = str(r.get("roomType", "")).upper() in ("LAB", "LABROOM")
        size = int(r["size"])
        cls_sec = f"{r['classGroupId']}::{r['sectionId']}"

        for day in days:
            day_periods = int(periods_by_day.get(day, 0))
            if day_periods <= 0:
                continue
            max_start = day_periods - size
            for start in range(0, max_start + 1):
                covered = list(range(start, start + size))
                # do not cross assembly slot
                if has_assembly and assembly_slot >= 0 and assembly_slot in covered:
                    continue
                # teacher unavailability
                if any(
                    p in (teacher_unavail.get(teacher, {}).get(day, []) or [])
                    for p in covered
                ):
                    continue

                v = model.NewBoolVar(f"r{rid}_{day}_{start}")
                req_placement_vars[rid].append((v, day, start, covered, needs_lab, teacher, cls_sec))
                teacher_weekly_vars[teacher].append((v, len(covered)))

                for p in covered:
                    class_slot_vars[(cls_sec, day, p)].append(v)
                    teacher_slot_vars[(teacher, day, p)].append(v)
                    if needs_lab:
                        lab_slot_vars[(day, p)].append(v)

    # Every requirement must be placed exactly once
    for rid in range(len(reqs)):
        vars_for_req = [x[0] for x in req_placement_vars[rid]]
        if not vars_for_req:
            print(json.dumps({"ok": False, "error": f"NO_PLACEMENT_OPTIONS:r{rid}"}))
            return
        model.Add(sum(vars_for_req) == 1)

    # Class slot clash
    for _, vars_for_slot in class_slot_vars.items():
        model.Add(sum(vars_for_slot) <= 1)

    # Teacher slot clash
    for _, vars_for_slot in teacher_slot_vars.items():
        model.Add(sum(vars_for_slot) <= 1)

    # Teacher weekly max
    for tid, vars_for_teacher in teacher_weekly_vars.items():
        model.Add(
            sum(v * size for v, size in vars_for_teacher) <= int(teacher_max.get(tid, 20))
        )

    # Lab capacity per slot
    lab_capacity = len(lab_ids)
    for _, vars_for_slot in lab_slot_vars.items():
        model.Add(sum(vars_for_slot) <= lab_capacity)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(payload.get("timeLimitSec", 25))
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(json.dumps({"ok": False, "error": "INFEASIBLE"}))
        return

    chosen = []
    for rid, places in req_placement_vars.items():
        req = reqs[rid]
        for v, day, start, covered, needs_lab, teacher, cls_sec in places:
            if solver.Value(v) == 1:
                class_group_id, section_id = cls_sec.split("::")
                for p in covered:
                    chosen.append(
                        {
                            "classGroupId": class_group_id,
                            "sectionId": section_id,
                            "day": day,
                            "period": p,
                            "subjectId": req["subjectId"],
                            "teacherId": teacher,
                            "needsLab": needs_lab,
                            "roomType": req.get("roomType", "CLASSROOM"),
                        }
                    )
                break

    # Assign concrete lab IDs greedily for occupied lab slots.
    by_slot = defaultdict(list)
    for i, c in enumerate(chosen):
        if c["needsLab"]:
            by_slot[(c["day"], c["period"])].append(i)
    for (day, period), idxs in by_slot.items():
        for j, idx in enumerate(idxs):
            chosen[idx]["labRoomId"] = lab_ids[j % len(lab_ids)] if lab_ids else ""
    for c in chosen:
        if "labRoomId" not in c:
            c["labRoomId"] = ""
        c.pop("needsLab", None)

    print(json.dumps({"ok": True, "slots": chosen, "warnings": []}))


if __name__ == "__main__":
    main()
