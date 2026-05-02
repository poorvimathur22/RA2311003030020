require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Log, setAuthToken } = require("../loggin_middleware");

setAuthToken(process.env.ACCESS_TOKEN);

const app = express();
app.use(express.json());

const BASE_URL = "http://20.207.122.201/evaluation-service";
const getHeaders = () => ({
  Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
});

// Knapsack algorithm - maximize impact within mechanic hours budget
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

  // Backtrack to find selected vehicles
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

// GET /depots - fetch all depots
app.get("/depots", async (req, res) => {
  try {
    await Log("backend", "info", "route", "GET /depots called");
    const response = await axios.get(`${BASE_URL}/depots`, { headers: getHeaders() });
    await Log("backend", "info", "service", `Fetched ${response.data.depots.length} depots`);
    res.json(response.data);
  } catch (error) {
    await Log("backend", "error", "handler", `Failed to fetch depots: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch depots" });
  }
});

// GET /vehicles - fetch all vehicles
app.get("/vehicles", async (req, res) => {
  try {
    await Log("backend", "info", "route", "GET /vehicles called");
    const response = await axios.get(`${BASE_URL}/vehicles`, { headers: getHeaders() });
    await Log("backend", "info", "service", `Fetched ${response.data.vehicles.length} vehicles`);
    res.json(response.data);
  } catch (error) {
    await Log("backend", "error", "handler", `Failed to fetch vehicles: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch vehicles" });
  }
});

// POST /schedule - solve knapsack for a depot
app.post("/schedule", async (req, res) => {
  const { depotId } = req.body;

  if (!depotId) {
    await Log("backend", "warn", "handler", "POST /schedule called without depotId");
    return res.status(400).json({ error: "depotId is required" });
  }

  try {
    await Log("backend", "info", "route", `POST /schedule called for depotId: ${depotId}`);

    // Fetch depots and vehicles in parallel
    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers: getHeaders() }),
      axios.get(`${BASE_URL}/vehicles`, { headers: getHeaders() }),
    ]);

    const depot = depotsRes.data.depots.find((d) => d.ID === depotId);
    if (!depot) {
      await Log("backend", "warn", "service", `Depot not found: ${depotId}`);
      return res.status(404).json({ error: "Depot not found" });
    }

    const vehicles = vehiclesRes.data.vehicles;
    const budget = depot.MechanicHours;

    await Log("backend", "debug", "service", `Running knapsack for depot ${depotId} with budget ${budget} hours and ${vehicles.length} vehicles`);

    const { selectedVehicles, totalImpact } = knapsack(vehicles, budget);

    await Log("backend", "info", "service", `Schedule computed: ${selectedVehicles.length} vehicles selected, total impact: ${totalImpact}`);

    res.json({
      depotId,
      mechanicHoursBudget: budget,
      totalImpact,
      totalDuration: selectedVehicles.reduce((sum, v) => sum + v.Duration, 0),
      selectedVehicles,
    });
  } catch (error) {
    await Log("backend", "error", "handler", `Schedule computation failed: ${error.message}`);
    res.status(500).json({ error: "Failed to compute schedule" });
  }
});

app.listen(3000, () => {
  console.log("Vehicle Maintenance Scheduler running on port 3000");
  Log("backend", "info", "service", "Vehicle Maintenance Scheduler server started on port 3000");
});