const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const teachersRoutes = require("./routes/teachers.routes");
const subjectsRoutes = require("./routes/subjects.routes");
const classesRoutes = require("./routes/classes.routes");
const labsRoutes = require("./routes/labs.routes");
const classSubjectsRoutes = require("./routes/classSubjects.routes");
const settingsRoutes = require("./routes/settings.routes");
const schoolsRoutes = require("./routes/schools.routes");
const adminRoutes = require("./routes/admin.routes");
const uploadRoutes = require("./routes/upload.routes");
const timetableRoutes = require("./routes/timetable.routes");
const pdfRoutes = require("./routes/pdf.routes");
const metaRoutes = require("./routes/meta.routes");

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
    credentials: false
  })
);
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/teachers", teachersRoutes);
app.use("/api/subjects", subjectsRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/labs", labsRoutes);
app.use("/api/class-subjects", classSubjectsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/schools", schoolsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/timetable", timetableRoutes);
app.use("/api/pdf", pdfRoutes);
app.use("/api/meta", metaRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
