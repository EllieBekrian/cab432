// ====== Imports ======
require('dotenv').config();
const express = require("express");
const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
const path = require("path");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const session = require("express-session");
const DynamoDBStore = require("connect-dynamodb")({ session });

// ====== App & core settings ======
const app = express();
app.set("trust proxy", 1); // IMPORTANT: Nginx/ELB in front (needed for rate-limit & secure cookies)
const port = process.env.PORT || 3000;

// ====== CORS ======
const corsOptions = {
  origin: ["http://localhost:3000", "https://cab432.com", "https://www.cab432.com"],
  credentials: true,
};
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret';
app.use(cors(corsOptions));

// ====== Body & Cookie Parsers ======
app.use(cookieParser(SESSION_SECRET));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====== File Upload ======
app.use(
  fileUpload({
    createParentPath: true,
    limits: { fileSize: 50 * 1024 * 1024 },
    debug: false,
  })
);

// ====== Rate Limit (after trust proxy, before routes) ======
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// ====== Session (Stateless via DynamoDB) ======
const store = new DynamoDBStore({
  table: process.env.SESSION_TABLE || "cab432_sessions",
  AWSRegion: process.env.AWS_REGION || "ap-southeast-2",
  createTable: true, // اگر جدول نبود و مجوز بود می‌سازه
  ttl: 86400,        // 1 day (seconds)
});

app.use(
  session({
    store,
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,     // چون HTTPS داری (Nginx terminates TLS)
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ====== Public session test route (for proof of statelessness) ======
app.get("/public-session-check", (req, res) => {
  req.session.views = (req.session.views || 0) + 1; // force a write to the store
  res.json({ ok: true, sessionId: req.sessionID, views: req.session.views });
});

// ====== Static files ======
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ====== Routes ======
const apiRoute = require("./routes/api");
const webclientRoute = require("./routes/webclient.js");
const adminRoute = require("./routes/admin.js");
const uploadRoute = require("./routes/upload.js");
const { getWeatherData } = require("./routes/weather.js");
app.use("/weather", getWeatherData);

app.use("/api/v1", apiRoute);
app.use("/", webclientRoute);
app.use("/admin", adminRoute);
app.use("/api/v1/upload", uploadRoute);

// ====== Error handler ======
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ====== Start server ======
app.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on port ${port}.`);
});



