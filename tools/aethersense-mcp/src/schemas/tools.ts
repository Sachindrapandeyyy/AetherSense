/**
 * Zod input schemas for all 20 ADR-124 MCP tools.
 *
 * §4.1  — 15 sensing tools (presence, vitals, pose, primitives, bfld, node, vector)
 * §4.1a — 5 policy / governance tools (AETHERSENSE-POLICY)
 *
 * Each exported schema is named `<CamelCase>InputSchema` matching the tool
 * name from the ADR-124 §4.1 catalog table. The parallel `TOOL_NAMES` array
 * is the single source of truth asserted by the schema-coverage test.
 */

import { z } from "zod";
import {
  NodeIdSchema,
  DurationSSchema,
  WindowSSchema,
  SemanticPrimitiveKindSchema,
  PosePersonResultSchema,
} from "./common.js";

// ── §4.1 Presence ──────────────────────────────────────────────────────────

/** aethersense.presence.now */
export const PresenceNowInputSchema = z.object({
  node_id: NodeIdSchema,
});

// ── §4.1 Vitals ───────────────────────────────────────────────────────────

/** aethersense.vitals.get_breathing */
export const VitalsGetBreathingInputSchema = z.object({
  node_id: NodeIdSchema,
  window_s: WindowSSchema,
});

/** aethersense.vitals.get_heart_rate */
export const VitalsGetHeartRateInputSchema = z.object({
  node_id: NodeIdSchema,
  window_s: WindowSSchema,
});

/** aethersense.vitals.get_all */
export const VitalsGetAllInputSchema = z.object({
  node_id: NodeIdSchema,
});

// ── §4.1 Pose ─────────────────────────────────────────────────────────────

/** aethersense.pose.latest */
export const PoseLatestInputSchema = z.object({
  node_id: NodeIdSchema,
});

/** aethersense.pose.subscribe */
export const PoseSubscribeInputSchema = z.object({
  node_id: NodeIdSchema,
  duration_s: DurationSSchema,
  callback_url: z
    .string()
    .url()
    .optional()
    .describe("Webhook URL to receive PoseDataMessage events (optional)."),
});

// ── §4.1 Primitives ───────────────────────────────────────────────────────

/** aethersense.primitives.get */
export const PrimitivesGetInputSchema = z.object({
  node_id: NodeIdSchema,
  primitive: SemanticPrimitiveKindSchema,
});

/** aethersense.primitives.list_active */
export const PrimitivesListActiveInputSchema = z.object({
  node_id: NodeIdSchema,
});

/** aethersense.primitives.subscribe */
export const PrimitivesSubscribeInputSchema = z.object({
  node_id: NodeIdSchema,
  primitive: SemanticPrimitiveKindSchema.optional().describe(
    "Subscribe to a specific primitive. Omit to receive all active primitives."
  ),
  duration_s: DurationSSchema,
});

// ── §4.1 BFLD ────────────────────────────────────────────────────────────

/** aethersense.bfld.last_scan */
export const BfldLastScanInputSchema = z.object({
  node_id: NodeIdSchema,
});

/** aethersense.bfld.subscribe */
export const BfldSubscribeInputSchema = z.object({
  node_id: NodeIdSchema,
  duration_s: DurationSSchema,
});

// ── §4.1 Node ────────────────────────────────────────────────────────────

/** aethersense.node.list — empty input per ADR-124 §4.1 table */
export const NodeListInputSchema = z.object({});

/** aethersense.node.status */
export const NodeStatusInputSchema = z.object({
  node_id: z.string().min(1).describe("Node id to query status for."),
});

// ── §4.1 Vector ──────────────────────────────────────────────────────────

/** aethersense.vector.search_pose */
export const VectorSearchPoseInputSchema = z.object({
  query_embedding: z
    .array(z.number())
    .min(1)
    .describe("Dense embedding vector to query against the HNSW index."),
  k: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(10)
    .describe("Number of nearest neighbours to return (default 10, max 100)."),
  node_id: NodeIdSchema,
});

/** aethersense.vector.store_pose */
export const VectorStorePoseInputSchema = z.object({
  pose: PosePersonResultSchema,
  node_id: z.string().min(1).describe("Node id that observed this pose."),
});

// ── §4.1a Policy / governance tools ──────────────────────────────────────

/** aethersense.policy.can_access_vitals */
export const PolicyCanAccessVitalsInputSchema = z.object({
  agent_id: z.string().min(1).describe("Calling agent identifier."),
  node_id: z.string().min(1).describe("Target sensing node."),
  vital: z
    .enum(["breathing", "heart_rate", "all"])
    .describe("Which vital the agent is requesting."),
});

/** aethersense.policy.can_query_presence */
export const PolicyCanQueryPresenceInputSchema = z.object({
  agent_id: z.string().min(1),
  scope: z
    .enum(["node", "fleet"])
    .describe("node = single node; fleet = all nodes / aggregated count."),
  node_id: NodeIdSchema,
  zone: z
    .string()
    .optional()
    .describe("Named zone within a node (e.g. 'living_room')."),
});

/** aethersense.policy.can_subscribe */
export const PolicyCanSubscribeInputSchema = z.object({
  agent_id: z.string().min(1),
  topic: z
    .string()
    .min(1)
    .describe("MQTT topic or tool name the agent wishes to subscribe to."),
  duration_s: DurationSSchema,
});

/** aethersense.policy.redact_identity_fields */
export const PolicyRedactIdentityFieldsInputSchema = z.object({
  payload: z.record(z.unknown()).describe("Tool return value to redact."),
  agent_id: z.string().min(1),
});

/** aethersense.policy.audit_log */
export const PolicyAuditLogInputSchema = z.object({
  agent_id: z.string().optional().describe("Filter to a specific agent."),
  since_ts: z
    .number()
    .optional()
    .describe("Return events after this Unix timestamp (ms)."),
});

// ── Catalog ───────────────────────────────────────────────────────────────

/**
 * Single source of truth: every tool name in the ADR-124 §4.1 + §4.1a catalog.
 * The schema-coverage test asserts this list exactly matches the exported schemas.
 */
export const TOOL_NAMES = [
  // §4.1 — 15 sensing tools
  "aethersense.presence.now",
  "aethersense.vitals.get_breathing",
  "aethersense.vitals.get_heart_rate",
  "aethersense.vitals.get_all",
  "aethersense.pose.latest",
  "aethersense.pose.subscribe",
  "aethersense.primitives.get",
  "aethersense.primitives.list_active",
  "aethersense.primitives.subscribe",
  "aethersense.bfld.last_scan",
  "aethersense.bfld.subscribe",
  "aethersense.node.list",
  "aethersense.node.status",
  "aethersense.vector.search_pose",
  "aethersense.vector.store_pose",
  // §4.1a — 5 policy tools
  "aethersense.policy.can_access_vitals",
  "aethersense.policy.can_query_presence",
  "aethersense.policy.can_subscribe",
  "aethersense.policy.redact_identity_fields",
  "aethersense.policy.audit_log",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Map from tool name → its Zod input schema. Used by the MCP server's
 * CallTool handler for uniform schema-validation before dispatch.
 */
export const TOOL_INPUT_SCHEMAS: Record<ToolName, z.ZodTypeAny> = {
  "aethersense.presence.now": PresenceNowInputSchema,
  "aethersense.vitals.get_breathing": VitalsGetBreathingInputSchema,
  "aethersense.vitals.get_heart_rate": VitalsGetHeartRateInputSchema,
  "aethersense.vitals.get_all": VitalsGetAllInputSchema,
  "aethersense.pose.latest": PoseLatestInputSchema,
  "aethersense.pose.subscribe": PoseSubscribeInputSchema,
  "aethersense.primitives.get": PrimitivesGetInputSchema,
  "aethersense.primitives.list_active": PrimitivesListActiveInputSchema,
  "aethersense.primitives.subscribe": PrimitivesSubscribeInputSchema,
  "aethersense.bfld.last_scan": BfldLastScanInputSchema,
  "aethersense.bfld.subscribe": BfldSubscribeInputSchema,
  "aethersense.node.list": NodeListInputSchema,
  "aethersense.node.status": NodeStatusInputSchema,
  "aethersense.vector.search_pose": VectorSearchPoseInputSchema,
  "aethersense.vector.store_pose": VectorStorePoseInputSchema,
  "aethersense.policy.can_access_vitals": PolicyCanAccessVitalsInputSchema,
  "aethersense.policy.can_query_presence": PolicyCanQueryPresenceInputSchema,
  "aethersense.policy.can_subscribe": PolicyCanSubscribeInputSchema,
  "aethersense.policy.redact_identity_fields": PolicyRedactIdentityFieldsInputSchema,
  "aethersense.policy.audit_log": PolicyAuditLogInputSchema,
};
