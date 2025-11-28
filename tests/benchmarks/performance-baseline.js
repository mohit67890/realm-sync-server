/**
 * Performance Baseline Script
 * Generates performance metrics for comparison
 */

const http = require("http");
const { performance } = require("perf_hooks");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const NUM_REQUESTS = 100;

async function measureLatency(endpoint) {
  return new Promise((resolve, reject) => {
    const start = performance.now();

    http
      .get(`${BASE_URL}${endpoint}`, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const latency = performance.now() - start;
          resolve({ latency, status: res.statusCode });
        });
      })
      .on("error", reject);
  });
}

async function runBenchmark() {
  console.log("🏃 Running performance baseline...\n");

  const results = {
    timestamp: new Date().toISOString(),
    health_endpoint: [],
    stats_endpoint: [],
  };

  // Test health endpoint
  for (let i = 0; i < NUM_REQUESTS; i++) {
    const result = await measureLatency("/health");
    results.health_endpoint.push(result.latency);
  }

  // Test stats endpoint
  for (let i = 0; i < NUM_REQUESTS; i++) {
    const result = await measureLatency("/stats");
    results.stats_endpoint.push(result.latency);
  }

  // Calculate statistics
  const calculate = (arr) => {
    arr.sort((a, b) => a - b);
    return {
      min: arr[0],
      max: arr[arr.length - 1],
      avg: arr.reduce((a, b) => a + b, 0) / arr.length,
      p50: arr[Math.floor(arr.length * 0.5)],
      p95: arr[Math.floor(arr.length * 0.95)],
      p99: arr[Math.floor(arr.length * 0.99)],
    };
  };

  const summary = {
    timestamp: results.timestamp,
    requests_per_endpoint: NUM_REQUESTS,
    health_endpoint: calculate(results.health_endpoint),
    stats_endpoint: calculate(results.stats_endpoint),
  };

  console.log(JSON.stringify(summary, null, 2));
}

runBenchmark().catch(console.error);
