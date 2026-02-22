const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    schoolCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    adminEmail: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    timezone: { type: String, default: "Asia/Kolkata" }
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

module.exports = mongoose.model("School", schoolSchema);
