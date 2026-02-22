const mongoose = require("mongoose");

const labRoomSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    subjectType: { type: String, default: "" },
    capacity: { type: Number, default: 30 }
  },
  { timestamps: true }
);

labRoomSchema.index({ schoolId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model("LabRoom", labRoomSchema);
