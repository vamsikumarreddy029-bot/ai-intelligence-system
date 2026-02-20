import express from "express";
import sqlite3 from "sqlite3";
import crypto from "crypto";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

/* ================= DB ================= */

/* ================= DB ================= */

const db = new sqlite3.Database("/tmp/news.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      summary TEXT,
      category TEXT,
      topic_hash TEXT UNIQUE,
      repetition_count INTEGER DEFAULT 1,
      score INTEGER DEFAULT 0,
      createdAt INTEGER
    )
  `);
});
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

app.post("/api/news/raw", (req, res) => {
  const { title, summary, category } = req.body;

  if (!title || !summary) {
    return res.json({ skipped: true });
  }

  const cleanTitle = clean(title);
  const cleanSummary = clean(summary);
  const topicHash = makeTopicHash(cleanTitle);

  db.get(
    `SELECT * FROM news WHERE topic_hash = ?`,
    [topicHash],
    (err, row) => {
      if (row) {
        const newCount = row.repetition_count + 1;
        const newScore = calculateScore(
          newCount,
          row.category,
          row.createdAt
        );

        db.run(
          `UPDATE news
           SET repetition_count = ?, score = ?
           WHERE topic_hash = ?`,
          [newCount, newScore, topicHash]
        );

        return res.json({ updated: true });
      }

      const createdAt = Date.now();
      const initialScore = calculateScore(1, category, createdAt);

      db.run(
        `INSERT INTO news
         (title, summary, category, topic_hash, repetition_count, score, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          summary,
          category || "State",
          topicHash,
          1,
          initialScore,
          createdAt
        ],
        () => res.json({ saved: true })
      );
    }
  );
});

/* ================= TRENDING ================= */

app.get("/api/trending", (req, res) => {
  db.all(
    `SELECT title, summary, category, repetition_count, score, createdAt
     FROM news
     ORDER BY score DESC
     LIMIT 20`,
    (_, rows) => res.json(rows)
  );
});

/* ================= CATEGORY ================= */

app.get("/api/category/:cat", (req, res) => {
  db.all(
    `SELECT title, summary, category, repetition_count, score, createdAt
     FROM news
     WHERE category = ?
     ORDER BY score DESC
     LIMIT 50`,
    [req.params.cat],
    (_, rows) => res.json(rows)
  );
});

/* ================= AUTO CLEANUP ================= */

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  db.run(
    `DELETE FROM news WHERE createdAt < ?`,
    [cutoff]
  );
}, 15 * 60 * 1000); // every 15 mins

/* ================= START ================= */

const PORT = process.env.PORT || 5051;
app.listen(PORT, "0.0.0.0", () =>
  console.log("✅ YT Intelligence backend running on", PORT)
);