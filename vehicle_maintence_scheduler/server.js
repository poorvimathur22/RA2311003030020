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
    clientSecret: "KDfgmVGEvHvMQMrD"
  });
  return response.data.access_token;
};

const getHeaders = async () => {
  const token = await getToken();
  setAuthToken(token);
  return { Authorization: `Bearer ${token}` };
};

function knapsack(vehicles, budget) {
  const n = vehicles.length;
  const dp = Array(n + 1).fill(null).map(() => Array(budget + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= budget; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }
  const selected = [];
  let w = budget;
  for (let i = n; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }
  return { selectedVehicles: selected, totalImpact: dp[n][budget] };
}

app.get("/depots", async (req, res) => {
  try {
    await Log("backend", "info", "route", "GET /depots called");
    const headers = await getHeaders();
    const response = await axios.get(`${BASE_URL}/depots`, { headers });
    await Log("backend", "info", "service", `Fetched ${response.data.depots.length} depots`);
    res.json(response.data);
  } catch (error) {
    await Log("backend", "error", "handler", `Failed to fetch depots: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch depots" });
  }
});

app.get("/vehicles", async (req, res) => {
  try {
    await Log("backend", "info", "route", "GET /vehicles called");
    const headers = await getHeaders();
    const response = await axios.get(`${BASE_URL}/vehicles`, { headers });
    await Log("backend", "info", "service", `Fetched ${response.data.vehicles.length} vehicles`);
    res.json(response.data);
  } catch (error) {
    await Log("backend", "error", "handler", `Failed to fetch vehicles: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch vehicles" });
  }
});

app.post("/schedule", async (req, res) => {
  const { depotId } = req.body;
  if (!depotId) return res.status(400).json({ error: "depotId is required" });
  try {
    await Log("backend", "info", "route", `POST /schedule called for depotId: ${depotId}`);
    const headers = await getHeaders();
    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers }),
      axios.get(`${BASE_URL}/vehicles`, { headers }),
    ]);
    
    const depot = depotsRes.data.depots.find((d) => d.ID === Number(depotId));
    if (!depot) return res.status(404).json({ error: "Depot not found" });
    const { selectedVehicles, totalImpact } = knapsack(vehiclesRes.data.vehicles, depot.MechanicHours);
    await Log("backend", "info", "service", `Schedule computed: ${selectedVehicles.length} vehicles, impact: ${totalImpact}`);
    res.json({ depotId, mechanicHoursBudget: depot.MechanicHours, totalImpact, selectedVehicles });
  } catch (error) {
    console.error("SCHEDULE ERROR:", error.message, error.response?.data);
    res.status(500).json({ error: "Failed to compute schedule" });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});