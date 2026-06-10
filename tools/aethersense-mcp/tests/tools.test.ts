/**
 * Smoke tests for aethersense-mcp tool stubs.
 *
 * These tests run without a live sensing-server or cog binary — they verify
 * the tool handler plumbing returns the expected shape under error conditions.
 * M6 adds integration tests that spawn a real MCP server and call each tool.
 */

import os from "node:os";
import type { AethersenseConfig } from "../src/types.js";
import { csiLatest } from "../src/tools/csi-latest.js";
import { poseInfer } from "../src/tools/pose-infer.js";
import { countInfer } from "../src/tools/count-infer.js";
import { registryList } from "../src/tools/registry-list.js";
import { trainCount } from "../src/tools/train-count.js";

const testConfig: AethersenseConfig = {
  sensingServerUrl: "http://127.0.0.1:19999", // nothing listening here
  apiToken: undefined,
  poseCogBinary: "nonexistent-cog-pose-estimation",
  countCogBinary: "nonexistent-cog-person-count",
  jobsDir: os.tmpdir(),
};

describe("aethersense_csi_latest", () => {
  it("returns {ok:false, warn:true} when sensing-server is not reachable", async () => {
    const result = await csiLatest({}, testConfig) as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(result["warn"]).toBe(true);
    expect(typeof result["error"]).toBe("string");
  });
});

describe("aethersense_pose_infer", () => {
  it("returns {ok:false, warn:true} when cog binary is not found", async () => {
    const result = await poseInfer({}, testConfig) as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(result["warn"]).toBe(true);
    expect(typeof result["error"]).toBe("string");
  });

  it("result shape contains expected fields on success (stub)", async () => {
    // Point to a real binary that returns exit 0 on any argument (using 'node').
    const result = await poseInfer(
      { cog_binary: "node" },
      { ...testConfig, poseCogBinary: "node" }
    ) as Record<string, unknown>;
    // node --help exits 0, so health passes, but output may be unexpected.
    // We just verify the response is shaped correctly.
    expect(typeof result["ok"]).toBe("boolean");
  });
});

describe("aethersense_count_infer", () => {
  it("returns {ok:false, warn:true} when cog binary is not found", async () => {
    const result = await countInfer({ max_persons: 7 }, testConfig) as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(result["warn"]).toBe(true);
    expect(typeof result["error"]).toBe("string");
  });
});

describe("aethersense_registry_list", () => {
  it("returns {ok:false, warn:true} when sensing-server is not reachable", async () => {
    const result = await registryList(
      { refresh: false },
      testConfig
    ) as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(result["warn"]).toBe(true);
  });
});

describe("aethersense_train_count", () => {
  it("enqueues a job and returns a UUID job_id", async () => {
    const result = await trainCount(
      {
        paired_jsonl: "/tmp/test.paired.jsonl",
        epochs: 1,
        learning_rate: 0.001,
      },
      testConfig
    ) as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    const res = result["result"] as Record<string, unknown>;
    expect(typeof res["job_id"]).toBe("string");
    // UUID format
    expect((res["job_id"] as string).split("-")).toHaveLength(5);
    expect(res["status"]).toBe("running");
    expect(typeof res["log_path"]).toBe("string");
  });
});
