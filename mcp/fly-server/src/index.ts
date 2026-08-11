#!/usr/bin/env node
/**
 * Fly.io MCP Server
 *
 * Exposes narrow-verb tools for Fly.io operations:
 * - deployment planning and application
 * - secret management
 * - app status and rollback
 *
 * Authentication: FLY_API_TOKEN (required), FLY_ORG (required)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const API_BASE = "https://api.fly.io/graphql";
const ORGANIZATION = process.env.FLY_ORG;
const TOKEN = process.env.FLY_API_TOKEN;

if (!TOKEN || !ORGANIZATION) {
  console.error(
    "Error: FLY_API_TOKEN and FLY_ORG environment variables are required"
  );
  process.exit(1);
}

// ============================================================================
// GraphQL Queries / Mutations
// ============================================================================

const QUERY_APP = `
  query GetApp($org: String!, $name: String!) {
    organization(slug: $org) {
      app(name: $name) {
        id
        name
        status
        deployed
        hostname
        currentRelease {
          id
          version
          createdAt
        }
      }
    }
  }
`;

const QUERY_SCALE = `
  query GetAppScale($org: String!, $name: String!) {
    organization(slug: $org) {
      app(name: $name) {
        machines {
          nodes {
            id
            name
            state
            region
            createdAt
          }
        }
      }
    }
  }
`;

// Note: In a real implementation, these would call the actual Fly.io GraphQL API.
// For now, they're structured to receive proper tool calls and return sensible stubs.

// ============================================================================
// GraphQL Client
// ============================================================================

async function callFlyAPI(query: string, variables: Record<string, any>) {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fly API error ${response.status}: ${text}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

// ============================================================================
// Tool Implementations
// ============================================================================

async function getAppStatus(appName: string) {
  const data = await callFlyAPI(QUERY_APP, {
    org: ORGANIZATION,
    name: appName,
  });

  const app = data.organization?.app;
  if (!app) {
    throw new Error(`App ${appName} not found`);
  }

  return {
    name: app.name,
    status: app.status,
    deployed: app.deployed,
    hostname: app.hostname,
    currentRelease: app.currentRelease,
  };
}

async function getAppScale(appName: string) {
  const data = await callFlyAPI(QUERY_SCALE, {
    org: ORGANIZATION,
    name: appName,
  });

  const app = data.organization?.app;
  if (!app) {
    throw new Error(`App ${appName} not found`);
  }

  return {
    machines: app.machines.nodes,
  };
}

async function createDeploymentPlan(
  appName: string,
  imageRef: string,
  environment: string
) {
  // In the vertical slice, this returns a stub plan.
  // In Phase 6, this calls the actual Fly API to compute a diff.
  return {
    appName,
    imageRef,
    environment,
    created: true,
    resources: [], // stub
    secrets: [], // stub
    regions: [], // stub
  };
}

async function applyDeploymentPlan(
  appName: string,
  planId: string,
  _approvalToken: string
) {
  // In the vertical slice, this returns a stub deployment.
  // In Phase 6, this calls the actual Fly API and applies the plan.
  // The _approvalToken parameter is verified upstream by the gate layer;
  // it's included here for documentation.
  return {
    deploymentId: `deploy-${Date.now()}`,
    appName,
    planId,
    status: "in_progress",
    appliedAt: new Date().toISOString(),
  };
}

async function getDeploymentStatus(deploymentId: string) {
  // Stub: in Phase 6, this polls the actual deployment status.
  return {
    deploymentId,
    status: "success",
    completedAt: new Date().toISOString(),
    imageRef: "ghcr.io/...",
  };
}

async function rollbackDeployment(
  appName: string,
  toRelease: string,
  _approvalToken: string
) {
  // The _approvalToken is verified upstream by the gate layer.
  return {
    appName,
    fromRelease: "current",
    toRelease,
    status: "in_progress",
    rolledBackAt: new Date().toISOString(),
  };
}

async function setSecret(appName: string, key: string, _value: string) {
  // Security: _value is never returned, logged, or cached.
  // The caller receives only confirmation, not the value itself.
  return {
    appName,
    key,
    set: true,
    setAt: new Date().toISOString(),
    // Never return the value
  };
}

// ============================================================================
// MCP Server
// ============================================================================

const server = new Server(
  {
    name: "fly-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools: Tool[] = [
  {
    name: "get_app_status",
    description: "Get the current status of a Fly.io app",
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "The name of the Fly.io app",
        },
      },
      required: ["app_name"],
    },
  },
  {
    name: "get_app_scale",
    description: "Get the current machine scale and regions for a Fly.io app",
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "The name of the Fly.io app",
        },
      },
      required: ["app_name"],
    },
  },
  {
    name: "create_deployment_plan",
    description:
      "Create a deployment plan (read-only; does not apply changes). Returns a diff for review.",
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "The name of the Fly.io app",
        },
        image_ref: {
          type: "string",
          description: "Container image reference (digest or tag)",
        },
        environment: {
          type: "string",
          enum: ["preview", "staging", "production"],
          description: "Target environment",
        },
      },
      required: ["app_name", "image_ref", "environment"],
    },
  },
  {
    name: "apply_deployment_plan",
    description:
      "Apply a deployment plan. Requires an approval token from the gate layer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "The name of the Fly.io app",
        },
        plan_id: {
          type: "string",
          description: "The deployment plan ID from create_deployment_plan",
        },
        approval_token: {
          type: "string",
          description:
            "Approval token from the gate layer. Non-optional; verified before apply.",
        },
      },
      required: ["app_name", "plan_id", "approval_token"],
    },
  },
  {
    name: "get_deployment_status",
    description: "Get the status of an ongoing or completed deployment",
    inputSchema: {
      type: "object" as const,
      properties: {
        deployment_id: {
          type: "string",
          description: "The deployment ID returned from apply_deployment_plan",
        },
      },
      required: ["deployment_id"],
    },
  },
  {
    name: "rollback_deployment",
    description:
      "Rollback to a previous release. Requires an approval token from the gate layer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "The name of the Fly.io app",
        },
        to_release: {
          type: "string",
          description: "Release version or ID to roll back to",
        },
        approval_token: {
          type: "string",
          description:
            "Approval token from the gate layer. Non-optional; verified before rollback.",
        },
      },
      required: ["app_name", "to_release", "approval_token"],
    },
  },
  {
    name: "set_secret",
    description:
      "Set a secret in the app environment. Value is never returned.",
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "The name of the Fly.io app",
        },
        key: {
          type: "string",
          description: "Secret name (e.g., DATABASE_URL, API_KEY)",
        },
        value: {
          type: "string",
          description:
            "Secret value. Never returned in responses or logs. Never stored in repo files.",
        },
      },
      required: ["app_name", "key", "value"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request;

  try {
    let result;

    switch (name) {
      case "get_app_status":
        result = await getAppStatus(args.app_name);
        break;

      case "get_app_scale":
        result = await getAppScale(args.app_name);
        break;

      case "create_deployment_plan":
        result = await createDeploymentPlan(
          args.app_name,
          args.image_ref,
          args.environment
        );
        break;

      case "apply_deployment_plan":
        result = await applyDeploymentPlan(
          args.app_name,
          args.plan_id,
          args.approval_token
        );
        break;

      case "get_deployment_status":
        result = await getDeploymentStatus(args.deployment_id);
        break;

      case "rollback_deployment":
        result = await rollbackDeployment(
          args.app_name,
          args.to_release,
          args.approval_token
        );
        break;

      case "set_secret":
        result = await setSecret(args.app_name, args.key, args.value);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
