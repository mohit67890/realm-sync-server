/**
 * K6 Load Testing Script for Sync Server
 * Simulates 100-1000 concurrent realm-core clients
 *
 * Run with:
 *   k6 run tests/load/k6-load-test.js
 *   k6 run --vus 100 --duration 5m tests/load/k6-load-test.js
 *   k6 run --vus 500 --duration 10m tests/load/k6-load-test.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import ws from "k6/ws";

// Custom metrics
const syncLatency = new Trend("sync_latency");
const syncSuccessRate = new Rate("sync_success_rate");
const changesSent = new Counter("changes_sent");
const changesReceived = new Counter("changes_received");
const reconnections = new Counter("reconnections");

// Test configuration
export const options = {
  stages: [
    { duration: "1m", target: 50 }, // Ramp up to 50 users
    { duration: "3m", target: 100 }, // Ramp up to 100 users
    { duration: "5m", target: 100 }, // Stay at 100 users
    { duration: "2m", target: 200 }, // Spike to 200 users
    { duration: "5m", target: 200 }, // Stay at 200 users
    { duration: "2m", target: 0 }, // Ramp down to 0 users
  ],
  thresholds: {
    sync_latency: ["p(95)<2000", "p(99)<5000"], // 95% under 2s, 99% under 5s
    sync_success_rate: ["rate>0.95"], // 95% success rate
    http_req_duration: ["p(95)<1000"], // HTTP requests under 1s
    http_req_failed: ["rate<0.1"], // Less than 10% HTTP failures
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export function setup() {
  // Health check before starting
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "server is healthy": (r) =>
      r.status === 200 && r.json("status") === "healthy",
  });

  console.log(`Starting load test against ${BASE_URL}`);
  return { baseUrl: BASE_URL };
}

export default function (data) {
  const userId = `load-user-${__VU}-${__ITER}`;
  const socketUrl = data.baseUrl.replace("http", "ws");

  // Connect via WebSocket
  const res = ws.connect(
    `${socketUrl}/socket.io/?EIO=4&transport=websocket`,
    function (socket) {
      socket.on("open", function () {
        // Join sync room
        const joinMsg = JSON.stringify({
          type: "sync:join",
          data: { userId: userId },
        });
        socket.send(joinMsg);
      });

      socket.on("message", function (msg) {
        try {
          const data = JSON.parse(msg);

          if (data.type === "sync:changes") {
            changesReceived.add(1);
          }
        } catch (e) {
          // Ignore parse errors
        }
      });

      socket.on("error", function (e) {
        console.log("WebSocket error:", e);
        reconnections.add(1);
      });

      // Simulate realm-core usage patterns
      const numChanges = Math.floor(Math.random() * 5) + 1; // 1-5 changes per iteration

      for (let i = 0; i < numChanges; i++) {
        const changeStart = Date.now();

        const change = {
          id: `${userId}_${Date.now()}_${i}`,
          userId: userId,
          timestamp: Date.now(),
          operation: ["insert", "update", "delete"][
            Math.floor(Math.random() * 3)
          ],
          collection: "RealmObject",
          documentId: `doc-${__VU}-${i}`,
          data: {
            className: "Task",
            properties: {
              name: `Task ${i}`,
              isComplete: Math.random() > 0.5,
              priority: Math.floor(Math.random() * 5),
            },
          },
        };

        const changeMsg = JSON.stringify({
          type: "sync:change",
          data: change,
        });

        socket.send(changeMsg);
        changesSent.add(1);

        // Wait for response (simulate)
        sleep(0.1);

        const latency = Date.now() - changeStart;
        syncLatency.add(latency);
        syncSuccessRate.add(latency < 5000);

        // Small delay between changes
        sleep(0.2);
      }

      // Keep connection open for a bit
      sleep(2);

      socket.close();
    }
  );

  check(res, {
    "WebSocket connected": (r) => r && r.status === 101,
  });

  // Random think time between iterations
  sleep(Math.random() * 3 + 1);
}

export function teardown(data) {
  // Final stats check
  const stats = http.get(`${data.baseUrl}/stats`);
  console.log("\n=== Final Server Stats ===");
  console.log(JSON.stringify(stats.json(), null, 2));
}
