const mongoose = require("mongoose");

const classSubjectSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    id: { type: String, required: true, trim: true },
    classGroupId: { type: String, required: true, trim: true },
    subjectId: { type: String, required: true, trim: true },
    teacherId: { type: String, default: "" },
    periodsPerWeek: { type: Number, required: true, default: 4 },
    roomType: { type: String, enum: ["CLASSROOM", "LAB", "LABROOM", "SPECIAL_ROOM"], default: "CLASSROOM" },
    requiresConsecutive: { type: Boolean, default: false },
    consecutiveSize: { type: Number, default: 2 }
  },
  { timestamps: true }
);

classSubjectSchema.index({ schoolId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model("ClassSubject", classSubjectSchema);
