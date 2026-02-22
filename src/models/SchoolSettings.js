const mongoose = require("mongoose");

const schoolSettingsSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, unique: true, index: true },
    periodDuration: { type: Number, default: 45 },
    periodsPerDay: { type: Number, default: 8 },
    workingDays: { type: Number, default: 5 },
    morningAssemblyPeriod: { type: Number, default: 0 },
    startTime: { type: String, default: "08:00" },
    workingDayNames: { type: [String], default: ["MON", "TUE", "WED", "THU", "FRI"] },
    totalDaysPerWeek: { type: Number, default: 5 },
    hasMorningAssembly: { type: Boolean, default: false },
    assemblySlot: { type: Number, default: 0 },
    saturdayHalfDay: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SchoolSettings", schoolSettingsSchema);
