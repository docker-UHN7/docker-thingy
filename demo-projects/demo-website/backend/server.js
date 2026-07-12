import cors from "cors";
import express from "express";
import pg from "pg";
import { createClient } from "redis";

const { Pool } = pg;

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://demo:demo@postgres:5432/demodb";
const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL });

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

const app = express();
app.use(cors());
app.use(express.json());

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS facts (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '✨',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM facts");
  if (rows[0].count === 0) {
    await pool.query(
      `INSERT INTO facts (text, emoji) VALUES
        ('Honey never spoils — archaeologists have found 3,000-year-old honey still edible.', '🍯'),
        ('Octopuses have three hearts and blue blood.', '🐙'),
        ('A group of flamingos is called a flamboyance.', '🦩'),
        ('Bananas are berries, but strawberries are not.', '🍌'),
        ('The Eiffel Tower grows about 6 inches taller in summer heat.', '🗼')`
    );
  }
}

async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await connectRedis();
    await redis.ping();
    res.json({ status: "ok", postgres: "up", redis: "up" });
  } catch (error) {
    res.status(503).json({
      status: "error",
      message: error instanceof Error ? error.message : "unhealthy"
    });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    await connectRedis();
    const visits = await redis.incr("demo:visits");
    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM facts");
    res.json({ visits, factCount: rows[0].count });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "failed to load stats"
    });
  }
});

app.get("/api/facts", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, text, emoji, created_at FROM facts ORDER BY RANDOM() LIMIT 5"
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "failed to load facts"
    });
  }
});

app.post("/api/facts", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  const emoji = String(req.body?.emoji ?? "✨").trim() || "✨";

  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    const { rows } = await pool.query(
      "INSERT INTO facts (text, emoji) VALUES ($1, $2) RETURNING id, text, emoji, created_at",
      [text, emoji.slice(0, 4)]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "failed to save fact"
    });
  }
});

async function start() {
  let retries = 30;
  while (retries > 0) {
    try {
      await pool.query("SELECT 1");
      await connectRedis();
      await redis.ping();
      break;
    } catch {
      retries -= 1;
      if (retries === 0) {
        throw new Error("Dependencies not ready after waiting");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  await ensureSchema();

  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});