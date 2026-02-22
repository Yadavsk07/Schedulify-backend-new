const mongoose = require("mongoose");

const classGroupSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    sections: { type: [String], default: [] },
    subjectIds: { type: [String], default: [] }
  },
  { timestamps: true }
);

classGroupSchema.index({ schoolId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model("ClassGroup", classGroupSchema);
