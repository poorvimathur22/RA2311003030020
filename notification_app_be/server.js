require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Log, setAuthToken } = require("../loggin_middleware");

const app = express();
app.use(express.json());

const BASE_URL = "http://20.207.122.201/evaluation-service";

const getToken = async () => {
  const response = await axios.post(`${BASE_URL}/auth`, {
    email: "pm0195@srmist.edu.in",
    name: "Poorvi Mathur",
    rollNo: "RA2311003030020",
    accessCode: "QkbpxH",
    clientID: "30d1716d-29b1-48db-90f4-c27a132b1c16",
    clientSecret: "KDfgmVGEvHvMQMrD",
  });
  return response.data.access_token;
};

const getHeaders = async () => {
  const token = await getToken();
  setAuthToken(token);
  return { Authorization: `Bearer ${token}` };
};

// Type weights: Placement > Result > Event
const TYPE_WEIGHT = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

// Compute priority score based on type weight and recency
function computeScore(notification) {
  const weight = TYPE_WEIGHT[notification.Type] || 1;
  const ageMs = Date.now() - new Date(notification.Timestamp).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  // Recency factor: decays over time, recent = higher score
  const recencyFactor = 1 / (1 + ageHours);
  return weight * recencyFactor;
}

// GET /priority-inbox?n=10 — returns top N priority notifications
app.get("/priority-inbox", async (req, res) => {
  const n = parseInt(req.query.n) || 10;

  try {
    await Log("backend", "info", "route", `GET /priority-inbox called with n=${n}`);

    const headers = await getHeaders();
    const response = await axios.get(`${BASE_URL}/notifications`, { headers });
    const notifications = response.data.notifications;

    await Log("backend", "info", "service", `Fetched ${notifications.length} notifications`);

    // Score and sort all notifications
    const scored = notifications.map((notif) => ({
      ...notif,
      score: computeScore(notif),
    }));

    // Sort by score descending and take top N
    scored.sort((a, b) => b.score - a.score);
    const topN = scored.slice(0, n);

    await Log("backend", "info", "service", `Returning top ${topN.length} priority notifications`);

    res.json({
      total_fetched: notifications.length,
      top_n: n,
      priority_inbox: topN.map((notif) => ({
        ID: notif.ID,
        Type: notif.Type,
        Message: notif.Message,
        Timestamp: notif.Timestamp,
        score: parseFloat(notif.score.toFixed(6)),
      })),
    });
  } catch (error) {
    console.error("PRIORITY INBOX ERROR:", error.message, error.response?.data);
    await Log("backend", "error", "handler", `Priority inbox failed: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch priority inbox" });
  }
});

// GET /notifications — fetch raw notifications from API
app.get("/notifications", async (req, res) => {
  try {
    await Log("backend", "info", "route", "GET /notifications called");
    const headers = await getHeaders();
    const response = await axios.get(`${BASE_URL}/notifications`, { headers });
    await Log("backend", "info", "service", `Fetched ${response.data.notifications.length} notifications`);
    res.json(response.data);
  } catch (error) {
    console.error("NOTIFICATIONS ERROR:", error.message, error.response?.data);
    await Log("backend", "error", "handler", `Notifications fetch failed: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

app.listen(3001, () => {
  console.log("Notification app running on port 3001");
  Log("backend", "info", "service", "Notification server started on port 3001");
});
