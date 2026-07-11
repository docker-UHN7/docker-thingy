const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const port = process.env.PORT || 3000;
const TASKS_CACHE_KEY = "tasks:all";
const CACHE_TTL_SECONDS = 30;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Redis is a cache-aside layer only - the API stays correct without it, just
// slower, so a Redis outage degrades performance instead of taking the app down.
const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (error) => console.error("[redis] connection error:", error.message));

async function connectRedis() {
  try {
    await redis.connect();
    console.log("[redis] connected");
  } catch (error) {
    console.error("[redis] failed to connect, continuing without cache:", error.message);
  }
}

async function withRetry(fn, { attempts = 10, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      console.log(`[db] attempt ${attempt} failed (${error.message}), retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return undefined;
}

async function migrate() {
  await withRetry(() =>
    pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  );
  console.log("[db] schema ready");
}

async function invalidateTasksCache() {
  if (!redis.isOpen) return;
  await redis.del(TASKS_CACHE_KEY).catch((error) => console.error("[redis] invalidate failed:", error.message));
}

async function listTasks() {
  if (redis.isOpen) {
    const cached = await redis.get(TASKS_CACHE_KEY).catch(() => null);
    if (cached) {
      return { tasks: JSON.parse(cached), source: "cache" };
    }
  }

  const result = await pool.query("SELECT id, title, done, created_at FROM tasks ORDER BY id DESC");

  if (redis.isOpen) {
    await redis
      .setEx(TASKS_CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(result.rows))
      .catch((error) => console.error("[redis] cache write failed:", error.message));
  }

  return { tasks: result.rows, source: "database" };
}

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/tasks", async (req, res) => {
  try {
    const { tasks, source } = await listTasks();
    res.set("X-Data-Source", source);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const result = await pool.query(
      "INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, done, created_at",
      [title]
    );
    await invalidateTasksCache();
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid task id" });
    return;
  }

  const done = Boolean(req.body?.done);

  try {
    const result = await pool.query(
      "UPDATE tasks SET done = $1 WHERE id = $2 RETURNING id, title, done, created_at",
      [done, id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    await invalidateTasksCache();
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid task id" });
    return;
  }

  try {
    const result = await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    await invalidateTasksCache();
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function main() {
  await connectRedis();
  await migrate();

  app.listen(port, () => {
    console.log(`demo-api listening on port ${port}`);
  });
}

main().catch((error) => {
  console.error("[api] fatal startup error:", error);
  process.exit(1);
});
