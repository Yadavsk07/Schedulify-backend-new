require("dotenv").config();
const app = require("./app");
const { connectDb } = require("./config/db");

const PORT = Number(process.env.PORT || 8080);
const MONGO_URI = process.env.MONGO_URI;

async function boot() {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }

  await connectDb(MONGO_URI);
  const server = app.listen(PORT, () => {
    console.log(`Schedulify backend running on port ${PORT}`);
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Startup failed: Port ${PORT} is already in use.`);
      process.exit(1);
    }
    console.error("Startup failed:", err.message);
    process.exit(1);
  });
}

boot().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
