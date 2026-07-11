const http = require("node:http");
const client = require("prom-client");

const port = process.env.PORT || 8090;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const requestCounter = new client.Counter({
  name: "sample_app_http_requests_total",
  help: "Total HTTP requests handled by sample-app",
  labelNames: ["route", "status"],
  registers: [register]
});

const requestDuration = new client.Histogram({
  name: "sample_app_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["route"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register]
});

// Simulates a small amount of variable work (and an occasional failure) so the
// dashboard has something more interesting to show than a flat line.
function simulateWork() {
  return new Promise((resolve, reject) => {
    const delayMs = Math.random() * 200;
    setTimeout(() => {
      if (Math.random() < 0.05) {
        reject(new Error("simulated downstream failure"));
        return;
      }
      resolve();
    }, delayMs);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.writeHead(200, { "content-type": register.contentType });
    res.end(await register.metrics());
    return;
  }

  const route = req.url === "/" ? "/" : "/other";
  const endTimer = requestDuration.startTimer({ route });

  try {
    await simulateWork();
    endTimer();
    requestCounter.inc({ route, status: "200" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "ok" }));
  } catch (error) {
    endTimer();
    requestCounter.inc({ route, status: "500" });
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, () => {
  console.log(`sample-app listening on port ${port}`);
});
