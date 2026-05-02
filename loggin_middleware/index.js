const axios = require("axios");

const LOG_API_URL = "http://20.207.122.201/evaluation-service/logs";

const VALID_STACKS = ["backend", "frontend"];
const VALID_LEVELS = ["debug", "info", "warn", "error", "fatal"];
const VALID_PACKAGES = [
  "cache", "controller", "cron_job", "db", "domain",
  "handler", "repository", "route", "service",
  "auth", "config", "middleware", "utils",
  "api", "component", "hook", "page", "state", "style"
];

let authToken = null;

const setAuthToken = (token) => {
  authToken = token;
};

const Log = async (stack, level, pkg, message) => {
  // Validate inputs
  if (!VALID_STACKS.includes(stack)) {
    console.error(`Invalid stack: ${stack}`);
    return;
  }
  if (!VALID_LEVELS.includes(level)) {
    console.error(`Invalid level: ${level}`);
    return;
  }
  if (!VALID_PACKAGES.includes(pkg)) {
    console.error(`Invalid package: ${pkg}`);
    return;
  }

  try {
    const response = await axios.post(
      LOG_API_URL,
      {
        stack,
        level,
        package: pkg,
        message,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`[LOG SUCCESS] ${level.toUpperCase()} - ${message}`, response.data);
    return response.data;
  } catch (error) {
    console.error(`[LOG FAILED] ${error.message}`);
  }
};

module.exports = { Log, setAuthToken };