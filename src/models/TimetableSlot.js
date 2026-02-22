const mongoose = require("mongoose");

const timetableSlotSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    classGroupId: { type: String, required: true, index: true },
    sectionId: { type: String, required: true, index: true },
    day: { type: String, required: true },
    period: { type: Number, required: true },
    subjectId: { type: String, required: true },
    teacherId: { type: String, required: true },
    labRoomId: { type: String, default: "" },
    roomType: { type: String, default: "CLASSROOM" },
    locked: { type: Boolean, default: false }
  },
  { timestamps: true }
);

timetableSlotSchema.index(
  { schoolId: 1, classGroupId: 1, sectionId: 1, day: 1, period: 1 },
  { unique: true }
);
timetableSlotSchema.index({ schoolId: 1, teacherId: 1, day: 1, period: 1 });

module.exports = mongoose.model("TimetableSlot", timetableSlotSchema);
