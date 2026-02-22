const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: "" },
    periodsPerWeek: { type: Number, default: 4 },
    requiresConsecutive: { type: Boolean, default: false },
    consecutiveSize: { type: Number, default: 2 },
    roomType: { type: String, enum: ["CLASSROOM", "LAB", "LABROOM", "SPECIAL_ROOM"], default: "CLASSROOM" },
    teacherId: { type: String, default: "" }
  },
  { timestamps: true }
);

subjectSchema.index({ schoolId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
