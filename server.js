import express from "express";
import crypto from "crypto";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* ================= DB ================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS news (
    id SERIAL PRIMARY KEY,
    title TEXT,
    summary TEXT,
    category TEXT,
    topic_hash TEXT UNIQUE,
    repetition_count INT DEFAULT 1,
    score INT DEFAULT 0,
    createdAt BIGINT
  )
`);

/* ================= HELPERS ================= */

function clean(t = "") {
  return t
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[0-9]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeTopicHash(title) {
  return crypto.createHash("sha1").update(title).digest("hex");
}

function calculateScore(count, category, createdAt) {
  let score = count * 6;

  const hoursOld = (Date.now() - createdAt) / (1000 * 60 * 60);

  if (hoursOld < 1) score += 10;
  else if (hoursOld < 3) score += 5;

  if (category === "Cricket") score += 3;
  if (category === "Politics") score += 2;

  return score;
}

/* ================= INGEST ================= */

app.post("/api/news/raw", async (req, res) => {
  const { title, summary, category } = req.body;

  if (!title || !summary) {
    return res.json({ skipped: true });
  }

  const cleanTitle = clean(title);
  const topicHash = makeTopicHash(cleanTitle);

  const existing = await pool.query(
    "SELECT * FROM news WHERE topic_hash = $1",
    [topicHash]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const newCount = row.repetition_count + 1;
    const newScore = calculateScore(newCount, row.category, row.createdAt);

    await pool.query(
      "UPDATE news SET repetition_count=$1, score=$2 WHERE topic_hash=$3",
      [newCount, newScore, topicHash]
    );

    return res.json({ updated: true });
  }

  const createdAt = Date.now();
  const initialScore = calculateScore(1, category, createdAt);

  await pool.query(
    `INSERT INTO news
     (title, summary, category, topic_hash, repetition_count, score, createdAt)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [title, summary, category || "State", topicHash, 1, initialScore, createdAt]
  );

  res.json({ saved: true });
});

/* ================= TRENDING ================= */

app.get("/api/trending", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM news ORDER BY score DESC LIMIT 20"
  );
  res.json(result.rows);
});

/* ================= START ================= */

const PORT = process.env.PORT || 5051;
app.listen(PORT, "0.0.0.0", () =>
  console.log("✅ YT Intelligence backend running on", PORT)
);