import { z } from "zod";

// Schema definitions for tool inputs
export const QueryInputSchema = z.object({
  sql: z.string().min(1, "SQL query cannot be empty"),
});

export type QueryInput = z.infer<typeof QueryInputSchema>;

// Issue schemas
export const IssueStatusEnum = z.enum(["backlog", "todo", "in_progress", "done"]);
export const IssuePriorityEnum = z.enum(["low", "medium", "high", "critical"]);
export const TestingStatusEnum = z.enum(["in_testing", "passed", "failed"]);

export const WriteIssueInputSchema = z.object({
  title: z.string().min(1, "Title cannot be empty"),
  description: z.string().min(1, "Description cannot be empty"),
  priority: IssuePriorityEnum.optional().default("medium"),
  status: IssueStatusEnum.optional().default("backlog"),
  assigned_to: z.string().optional(),
  feature_id: z.number().optional(),
  sprint_id: z.number().optional(),
  opened_by: z.string().optional(),
  impact_analysis: z.string().optional(),
});

export const UpdateIssueInputSchema = z.object({
  id: z.number().min(1, "Issue ID is required"),
  title: z.string().optional(),
  description: z.string().optional(),
  status: IssueStatusEnum.optional(),
  priority: IssuePriorityEnum.optional(),
  assigned_to: z.string().nullable().optional(),
  resolution: z.string().optional(),
  impact_analysis: z.string().optional(),
  testing_status: TestingStatusEnum.optional(),
  user_tested: z.boolean().optional(),
  user_test_result: z.string().optional(),
  user_test_assessment: z.string().optional(),
});

export type WriteIssueInput = z.infer<typeof WriteIssueInputSchema>;
export type UpdateIssueInput = z.infer<typeof UpdateIssueInputSchema>;

// Feature schemas
export const FeatureStatusEnum = z.enum(["backlog", "todo", "in_progress", "done"]);
export const FeaturePriorityEnum = z.enum(["low", "medium", "high"]);

export const WriteFeatureInputSchema = z.object({
  title: z.string().min(1, "Title cannot be empty"),
  description: z.string().min(1, "Description cannot be empty"),
  priority: FeaturePriorityEnum.optional().default("medium"),
  status: FeatureStatusEnum.optional().default("backlog"),
  assigned_to: z.string().optional(),
  sprint_id: z.number().optional(),
  opened_by: z.string().optional(),
  impact_analysis: z.string().optional(),
});

export const UpdateFeatureInputSchema = z.object({
  id: z.number().min(1, "Feature ID is required"),
  title: z.string().optional(),
  description: z.string().optional(),
  status: FeatureStatusEnum.optional(),
  priority: FeaturePriorityEnum.optional(),
  assigned_to: z.string().nullable().optional(),
  resolution: z.string().optional(),
  impact_analysis: z.string().optional(),
  testing_status: TestingStatusEnum.optional(),
  user_tested: z.boolean().optional(),
  user_test_result: z.string().optional(),
  user_test_assessment: z.string().optional(),
});

export type WriteFeatureInput = z.infer<typeof WriteFeatureInputSchema>;
export type UpdateFeatureInput = z.infer<typeof UpdateFeatureInputSchema>;

// Database result types
export interface TableInfo {
  table_schema: string;
  table_name: string;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface TableSchema {
  schema: string;
  table: string;
  columns: ColumnInfo[];
}

export interface TableResource {
  schema: TableSchema;
  sampleRows: Record<string, unknown>[];
}

// MCP Response types
export interface McpToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export interface McpResourceResponse {
  contents: Array<{
    uri: string;
    text: string;
  }>;
}

// Configuration types
export interface ServerConfig {
  databaseUrl: string;
  allowWriteOps: boolean;
  maxConnections: number;
  connectionTimeout: number;
  statementTimeout: number;
  prepareStatements: boolean;
  debug: boolean;
  sslRootCertPath?: string;
  requireSsl?: boolean;
  sslRejectUnauthorized?: boolean;
  fetchTypes?: boolean;
}

// Error types
export class PostgresError extends Error {
  constructor(
    message: string,
    public code?: string,
    public detail?: string
  ) {
    super(message);
    this.name = "PostgresError";
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryValidationError";
  }
}
