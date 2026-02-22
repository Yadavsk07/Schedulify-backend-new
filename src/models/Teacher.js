const mongoose = require("mongoose");

const teacherSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    subjectIds: { type: [String], default: [] },
    classGroupIds: { type: [String], default: [] },
    level: { type: String, enum: ["JUNIOR", "SENIOR"], default: "SENIOR" },
    maxPeriodsPerWeek: { type: Number, default: 20 },
    unavailable: { type: Map, of: [Number], default: {} },
    preferredOffPeriods: { type: [Number], default: [] }
  },
  { timestamps: true }
);

teacherSchema.index({ schoolId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model("Teacher", teacherSchema);
