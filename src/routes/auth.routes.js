const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const School = require("../models/School");
const Teacher = require("../models/Teacher");

const router = express.Router();

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d"
  });
}

router.post("/admin/register", async (req, res) => {
  try {
    const { name, schoolCode, email, password } = req.body;
    if (!name || !schoolCode || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existing = await School.findOne({ schoolCode: schoolCode.toUpperCase() });
    if (existing) return res.status(409).json({ error: "School code already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const school = await School.create({
      name,
      schoolCode: schoolCode.toUpperCase(),
      adminEmail: email,
      passwordHash
    });

    return res.status(201).json({
      message: "School registered successfully",
      schoolId: String(school._id)
    });
  } catch (e) {
    return res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/admin/login", async (req, res) => {
  try {
    const { schoolCode, password } = req.body;
    if (!schoolCode || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    const school = await School.findOne({ schoolCode: schoolCode.toUpperCase() });
    if (!school) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, school.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const schoolId = String(school._id);
    const token = signToken({ role: "ADMIN", schoolId, schoolCode: school.schoolCode });
    return res.json({ token, schoolId });
  } catch (e) {
    return res.status(500).json({ error: "Login failed" });
  }
});

router.post("/teacher/login", async (req, res) => {
  try {
    const { schoolCode, teacherId } = req.body;
    if (!schoolCode || !teacherId) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    const school = await School.findOne({ schoolCode: schoolCode.toUpperCase() });
    if (!school) return res.status(401).json({ error: "Invalid credentials" });

    const schoolId = String(school._id);
    const teacher = await Teacher.findOne({ schoolId, id: teacherId.trim() });
    if (!teacher) return res.status(401).json({ error: "Teacher not found" });

    const token = signToken({
      role: "TEACHER",
      schoolId,
      teacherId: teacher.id,
      schoolCode: school.schoolCode
    });

    return res.json({ token, schoolId, teacherId: teacher.id });
  } catch (e) {
    return res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;
