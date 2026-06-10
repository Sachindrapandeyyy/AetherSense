/**
 * Configuration loader for the AetherSense CLI.
 * Mirrors tools/aethersense-mcp/src/config.ts — sourced from environment variables.
 */

import os from "node:os";
import path from "node:path";

export interface AethersenseCliConfig {
  sensingServerUrl: string;
  apiToken: string | undefined;
  poseCogBinary: string;
  countCogBinary: string;
  jobsDir: string;
}

function envOrDefault(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): AethersenseCliConfig {
  return {
    sensingServerUrl: envOrDefault(
      "AETHERSENSE_SENSING_SERVER_URL",
      "http://localhost:3000"
    ),
    apiToken: process.env["AETHERSENSE_API_TOKEN"],
    poseCogBinary: envOrDefault("AETHERSENSE_POSE_COG_BINARY", "cog-pose-estimation"),
    countCogBinary: envOrDefault("AETHERSENSE_COUNT_COG_BINARY", "cog-person-count"),
    jobsDir: envOrDefault(
      "AETHERSENSE_JOBS_DIR",
      path.join(os.homedir(), ".aethersense", "jobs")
    ),
  };
}
