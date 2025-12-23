import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, validateConfig } from './config.js';
import { DatabaseConnection } from './database.js';
import { ConsoleLogger } from './logger.js';
import { QueryValidator } from './query-validator.js';
import type { QueryInput, WriteIssueInput, UpdateIssueInput, WriteFeatureInput, UpdateFeatureInput } from './types.js';
import {
  QueryInputSchema,
  WriteIssueInputSchema,
  UpdateIssueInputSchema,
  WriteFeatureInputSchema,
  UpdateFeatureInputSchema
} from './types.js';

export interface PostgresMcpDeps {
  logger: ConsoleLogger;
  db: DatabaseConnection;
  queryValidator: QueryValidator;
}

export interface PostgresMcp {
  server: McpServer;
  ctx: PostgresMcpDeps;
}

/**
 * Create and configure the MCP server with all Postgres tools/resources.
 * Shared by both stdio and HTTP entrypoints.
 */
export type TransportKind = 'stdio' | 'http';

export function createPostgresMcpServer(transportKind: TransportKind = 'stdio'): PostgresMcp {
  const config = loadConfig();
  validateConfig(config);

  const logger = new ConsoleLogger(
    config.debug,
    // For stdio transport, suppress non-error logs to avoid corrupting the stream
    transportKind === 'stdio' ? 0 /* LogLevel.ERROR */ : undefined
  );
  const db = new DatabaseConnection(config, logger);
  const queryValidator = new QueryValidator(config.allowWriteOps, logger);

  const server = new McpServer({
    name: 'postgres-mcp-server',
    version: '0.1.0'
  });

  // Register query tool
  server.registerTool(
    'query',
    {
      title: 'PostgreSQL Query',
      description:
        'Execute a SQL query against the configured PostgreSQL database. ' +
        'Read-only by default; enable writes via DANGEROUSLY_ALLOW_WRITE_OPS environment variable.',
      inputSchema: { sql: QueryInputSchema.shape.sql }
    },
    async (args: unknown) => {
      try {
        const input = QueryInputSchema.parse(args) as QueryInput;
        queryValidator.validate(input.sql);
        const rows = await db.executeQuery(input.sql);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(rows, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error('Query tool error', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: errorMessage }, null, 2)
            }
          ]
        };
      }
    }
  );

  // Register tables resource
  server.registerResource(
    'tables',
    'postgres://tables',
    {
      title: 'PostgreSQL Tables',
      description: 'List all tables available in the connected PostgreSQL database.',
      mimeType: 'application/json'
    },
    async uri => {
      try {
        const tables = await db.getTables();
        return {
          contents: [{ uri: uri.href, text: JSON.stringify(tables, null, 2) }]
        };
      } catch (error) {
        logger.error('Tables resource error', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to retrieve tables';
        return {
          contents: [{ uri: uri.href, text: JSON.stringify({ error: errorMessage }, null, 2) }]
        };
      }
    }
  );

  // Register table detail resource
  server.registerResource(
    'table',
    new ResourceTemplate('postgres://table/{schema}/{table}', {
      // Expose each table as a discoverable MCP resource
      async list() {
        const tables = await db.getTables();
        return {
          resources: tables.map(t => ({
            uri: `postgres://table/${encodeURIComponent(t.table_schema)}/${encodeURIComponent(t.table_name)}`,
            name: `${t.table_schema}.${t.table_name}`,
            description: `Schema and sample rows for ${t.table_schema}.${t.table_name}`,
            mimeType: 'application/json'
          }))
        };
      }
    }),
    {
      title: 'PostgreSQL Table Details',
      description: 'Get schema information and sample rows for a specific table',
      mimeType: 'application/json'
    },
    async (uri, rawArgs) => {
      try {
        const schema = String(rawArgs?.schema ?? '');
        const table = String(rawArgs?.table ?? '');
        if (!schema || !table) {
          throw new Error('Schema and table parameters are required');
        }
        const tableDetails = await db.getTableDetails(schema, table);
        return {
          contents: [{ uri: uri.href, text: JSON.stringify(tableDetails, null, 2) }]
        };
      } catch (error) {
        logger.error('Table detail resource error', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to retrieve table details';
        return {
          contents: [{ uri: uri.href, text: JSON.stringify({ error: errorMessage }, null, 2) }]
        };
      }
    }
  );

  // Register fetch_next_issue tool
  server.registerTool(
    'fetch_next_issue',
    {
      title: 'Fetch Next Issue',
      description:
        'Fetch the next issue to work on from the issues table. ' +
        "Returns the highest priority issue with status 'todo' or 'backlog', ordered by priority (critical > high > medium > low) and creation date.",
      inputSchema: {}
    },
    async () => {
      try {
        const sql = `
          SELECT * FROM issues 
          WHERE status IN ('todo', 'backlog') 
          ORDER BY 
            CASE priority 
              WHEN 'critical' THEN 1 
              WHEN 'high' THEN 2 
              WHEN 'medium' THEN 3 
              WHEN 'low' THEN 4 
            END,
            created_at ASC
          LIMIT 1
        `;
        const rows = await db.executeQuery(sql);
        if (rows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ message: 'No pending issues found' }, null, 2)
              }
            ]
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(rows[0], null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error('fetch_next_issue tool error', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: errorMessage }, null, 2)
            }
          ]
        };
      }
    }
  );

  // Register write_issue tool
  server.registerTool(
    'write_issue',
    {
      title: 'Write Issue',
      description:
        'Create a new issue in the issues table. ' +
        'Requires title and description. Optional: priority (low/medium/high/critical), status (backlog/todo/in_progress/done), assigned_to, feature_id, sprint_id, opened_by, impact_analysis.',
      inputSchema: {
        title: WriteIssueInputSchema.shape.title,
        description: WriteIssueInputSchema.shape.description,
        priority: WriteIssueInputSchema.shape.priority,
        status: WriteIssueInputSchema.shape.status,
        assigned_to: WriteIssueInputSchema.shape.assigned_to,
        feature_id: WriteIssueInputSchema.shape.feature_id,
        sprint_id: WriteIssueInputSchema.shape.sprint_id,
        opened_by: WriteIssueInputSchema.shape.opened_by,
        impact_analysis: WriteIssueInputSchema.shape.impact_analysis
      }
    },
    async (args: unknown) => {
      try {
        const input = WriteIssueInputSchema.parse(args) as WriteIssueInput;

        // Get next number
        const numberResult = await db.executeQuery('SELECT COALESCE(MAX(number), 0) + 1 as next_number FROM issues');
        const nextNumber = numberResult[0]?.next_number ?? 1;

        const sql = `
          INSERT INTO issues (number, title, description, priority, status, assigned_to, feature_id, sprint_id, opened_by, impact_analysis)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `;
        const values = [
          nextNumber,
          input.title,
          input.description,
          input.priority || 'medium',
          input.status || 'backlog',
          input.assigned_to || null,
          input.feature_id || null,
          input.sprint_id || null,
          input.opened_by || null,
          input.impact_analysis || null
        ];

        const rows = await db.executeParameterizedQuery(sql, values);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ message: 'Issue created successfully', issue: rows[0] }, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error('write_issue tool error', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: errorMessage }, null, 2)
            }
          ]
        };
      }
    }
  );

  // Register update_issue tool
  server.registerTool(
    'update_issue',
    {
      title: 'Update Issue',
      description:
        'Update an existing issue in the issues table. ' +
        'Requires id. Optional fields to update: title, description, status, priority, assigned_to, resolution, impact_analysis, testing_status, user_tested, user_test_result, user_test_assessment.',
      inputSchema: {
        id: UpdateIssueInputSchema.shape.id,
        title: UpdateIssueInputSchema.shape.title,
        description: UpdateIssueInputSchema.shape.description,
        status: UpdateIssueInputSchema.shape.status,
        priority: UpdateIssueInputSchema.shape.priority,
        assigned_to: UpdateIssueInputSchema.shape.assigned_to,
        resolution: UpdateIssueInputSchema.shape.resolution,
        impact_analysis: UpdateIssueInputSchema.shape.impact_analysis,
        testing_status: UpdateIssueInputSchema.shape.testing_status,
        user_tested: UpdateIssueInputSchema.shape.user_tested,
        user_test_result: UpdateIssueInputSchema.shape.user_test_result,
        user_test_assessment: UpdateIssueInputSchema.shape.user_test_assessment
      }
    },
    async (args: unknown) => {
      try {
        const input = UpdateIssueInputSchema.parse(args) as UpdateIssueInput;

        // Build dynamic update query
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (input.title !== undefined) {
          updates.push(`title = $${paramIndex++}`);
          values.push(input.title);
        }
        if (input.description !== undefined) {
          updates.push(`description = $${paramIndex++}`);
          values.push(input.description);
        }
        if (input.status !== undefined) {
          updates.push(`status = $${paramIndex++}`);
          values.push(input.status);
          if (input.status === 'done') {
            updates.push(`resolved_at = NOW()`);
          }
        }
        if (input.priority !== undefined) {
          updates.push(`priority = $${paramIndex++}`);
          values.push(input.priority);
        }
        if (input.assigned_to !== undefined) {
          updates.push(`assigned_to = $${paramIndex++}`);
          values.push(input.assigned_to);
        }
        if (input.resolution !== undefined) {
          updates.push(`resolution = $${paramIndex++}`);
          values.push(input.resolution);
        }
        if (input.impact_analysis !== undefined) {
          updates.push(`impact_analysis = $${paramIndex++}`);
          values.push(input.impact_analysis);
        }
        if (input.testing_status !== undefined) {
          updates.push(`testing_status = $${paramIndex++}`);
          values.push(input.testing_status);
        }
        if (input.user_tested !== undefined) {
          updates.push(`user_tested = $${paramIndex++}`);
          values.push(input.user_tested);
        }
        if (input.user_test_result !== undefined) {
          updates.push(`user_test_result = $${paramIndex++}`);
          values.push(input.user_test_result);
        }
        if (input.user_test_assessment !== undefined) {
          updates.push(`user_test_assessment = $${paramIndex++}`);
          values.push(input.user_test_assessment);
        }

        if (updates.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'No fields to update' }, null, 2)
              }
            ]
          };
        }

        updates.push(`updated_at = NOW()`);
        values.push(input.id);

        const sql = `UPDATE issues SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const rows = await db.executeParameterizedQuery(sql, values);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Issue with id ${input.id} not found` }, null, 2)
              }
            ]
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ message: 'Issue updated successfully', issue: rows[0] }, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error('update_issue tool error', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: errorMessage }, null, 2)
            }
          ]
        };
      }
    }
  );

  // Register fetch_next_feature tool
  server.registerTool(
    'fetch_next_feature',
    {
      title: 'Fetch Next Feature',
      description:
        'Fetch the next feature to work on from the features table. ' +
        "Returns the highest priority feature with status 'todo' or 'backlog', ordered by priority (high > medium > low) and creation date.",
      inputSchema: {}
    },
    async () => {
      try {
        const sql = `
          SELECT * FROM features 
          WHERE status IN ('todo', 'backlog') 
          ORDER BY 
            CASE priority 
              WHEN 'high' THEN 1 
              WHEN 'medium' THEN 2 
              WHEN 'low' THEN 3 
            END,
            created_at ASC
          LIMIT 1
        `;
        const rows = await db.executeQuery(sql);
        if (rows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ message: 'No pending features found' }, null, 2)
              }
            ]
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(rows[0], null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error('fetch_next_feature tool error', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: errorMessage }, null, 2)
            }
          ]
        };
      }
    }
  );

  // Register update_feature tool
  server.registerTool(
    'update_feature',
    {
      title: 'Update Feature',
      description:
        'Update an existing feature in the features table. ' +
        'Requires id. Optional fields to update: title, description, status, priority, assigned_to, resolution, impact_analysis, testing_status, user_tested, user_test_result, user_test_assessment.',
      inputSchema: {
        id: UpdateFeatureInputSchema.shape.id,
        title: UpdateFeatureInputSchema.shape.title,
        description: UpdateFeatureInputSchema.shape.description,
        status: UpdateFeatureInputSchema.shape.status,
        priority: UpdateFeatureInputSchema.shape.priority,
        assigned_to: UpdateFeatureInputSchema.shape.assigned_to,
        resolution: UpdateFeatureInputSchema.shape.resolution,
        impact_analysis: UpdateFeatureInputSchema.shape.impact_analysis,
        testing_status: UpdateFeatureInputSchema.shape.testing_status,
        user_tested: UpdateFeatureInputSchema.shape.user_tested,
        user_test_result: UpdateFeatureInputSchema.shape.user_test_result,
        user_test_assessment: UpdateFeatureInputSchema.shape.user_test_assessment
      }
    },
    async (args: unknown) => {
      try {
        const input = UpdateFeatureInputSchema.parse(args) as UpdateFeatureInput;

        // Build dynamic update query
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (input.title !== undefined) {
          updates.push(`title = $${paramIndex++}`);
          values.push(input.title);
        }
        if (input.description !== undefined) {
          updates.push(`description = $${paramIndex++}`);
          values.push(input.description);
        }
        if (input.status !== undefined) {
          updates.push(`status = $${paramIndex++}`);
          values.push(input.status);
          if (input.status === 'done') {
            updates.push(`resolved_at = NOW()`);
          }
        }
        if (input.priority !== undefined) {
          updates.push(`priority = $${paramIndex++}`);
          values.push(input.priority);
        }
        if (input.assigned_to !== undefined) {
          updates.push(`assigned_to = $${paramIndex++}`);
          values.push(input.assigned_to);
        }
        if (input.resolution !== undefined) {
          updates.push(`resolution = $${paramIndex++}`);
          values.push(input.resolution);
        }
        if (input.impact_analysis !== undefined) {
          updates.push(`impact_analysis = $${paramIndex++}`);
          values.push(input.impact_analysis);
        }
        if (input.testing_status !== undefined) {
          updates.push(`testing_status = $${paramIndex++}`);
          values.push(input.testing_status);
        }
        if (input.user_tested !== undefined) {
          updates.push(`user_tested = $${paramIndex++}`);
          values.push(input.user_tested);
        }
        if (input.user_test_result !== undefined) {
          updates.push(`user_test_result = $${paramIndex++}`);
          values.push(input.user_test_result);
        }
        if (input.user_test_assessment !== undefined) {
          updates.push(`user_test_assessment = $${paramIndex++}`);
          values.push(input.user_test_assessment);
        }

        if (updates.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'No fields to update' }, null, 2)
              }
            ]
          };
        }

        updates.push(`updated_at = NOW()`);
        values.push(input.id);

        const sql = `UPDATE features SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const rows = await db.executeParameterizedQuery(sql, values);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Feature with id ${input.id} not found` }, null, 2)
              }
            ]
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ message: 'Feature updated successfully', feature: rows[0] }, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error('update_feature tool error', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: errorMessage }, null, 2)
            }
          ]
        };
      }
    }
  );

  return { server, ctx: { logger, db, queryValidator } };
}
