#!/usr/bin/env node
/**
 * Container Registry MCP Server
 *
 * Exposes narrow-verb tools for container registry operations:
 * - image metadata queries
 * - push operations (gated by approval token)
 * - scan results and vulnerability data
 *
 * Authentication: REGISTRY_HOST, REGISTRY_USERNAME, REGISTRY_PASSWORD (or auth token)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const REGISTRY_HOST = process.env.REGISTRY_HOST || "ghcr.io";
const REGISTRY_TOKEN = process.env.GHCR_TOKEN;

// Note: In production, this would authenticate to the real registry.
// For now, it's structured to accept and respond to proper tool calls.

// ============================================================================
// Tool Implementations
// ============================================================================

async function getImageMetadata(imageRef: string) {
  // In Phase 5, this calls the real registry API (e.g., GHCR, ECR, Docker Hub).
  // For now, returns a stub.
  const [repo, tag] = imageRef.includes(":")
    ? imageRef.split(":")
    : [imageRef, "latest"];

  return {
    repository: repo,
    tag,
    registry: REGISTRY_HOST,
    digest: `sha256:${Math.random().toString(16).slice(2)}`,
    size: 142557312, // ~136 MB
    createdAt: new Date().toISOString(),
    os: "linux",
    arch: "amd64",
  };
}

async function getScanResults(imageRef: string) {
  // In Phase 5, this retrieves Trivy or Grype scan results.
  // For now, returns a stub.
  return {
    imageRef,
    scannedAt: new Date().toISOString(),
    summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    findings: [],
  };
}

async function pushImage(
  imageRef: string,
  layerDigests: string[],
  _approvalToken: string
) {
  // The _approvalToken is verified upstream by the gate layer.
  // This tool never returns credentials or accepts them as input.
  return {
    imageRef,
    pushed: true,
    pushedAt: new Date().toISOString(),
    layersCount: layerDigests.length,
    // Never return the token or any authentication details
  };
}

async function deleteImage(imageRef: string, _approvalToken: string) {
  // Destructive operation; requires approval token.
  return {
    imageRef,
    deleted: true,
    deletedAt: new Date().toISOString(),
  };
}

async function tagImage(
  sourceRef: string,
  targetRef: string,
  _approvalToken: string
) {
  // Creating an alias (e.g., promoting sha tag to 'latest').
  // Mutating, but not destructive; still gated for audit.
  return {
    source: sourceRef,
    target: targetRef,
    tagged: true,
    taggedAt: new Date().toISOString(),
  };
}

// ============================================================================
// MCP Server
// ============================================================================

const server = new Server(
  {
    name: "registry-mcp-server",
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
    name: "get_image_metadata",
    description:
      "Get metadata for a container image (size, digest, creation date, OS/arch)",
    inputSchema: {
      type: "object" as const,
      properties: {
        image_ref: {
          type: "string",
          description: "Image reference (repo:tag or repo@digest)",
        },
      },
      required: ["image_ref"],
    },
  },
  {
    name: "get_scan_results",
    description: "Get vulnerability scan results for an image (Trivy or Grype)",
    inputSchema: {
      type: "object" as const,
      properties: {
        image_ref: {
          type: "string",
          description: "Image reference",
        },
      },
      required: ["image_ref"],
    },
  },
  {
    name: "push_image",
    description:
      "Push an image to the registry. Requires an approval token from the gate layer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        image_ref: {
          type: "string",
          description: "Image reference to push (must include digest or tag)",
        },
        layer_digests: {
          type: "array",
          items: {
            type: "string",
          },
          description: "SHA256 digests of all layers in the image",
        },
        approval_token: {
          type: "string",
          description:
            "Approval token from the gate layer. Non-optional; verified before push.",
        },
      },
      required: ["image_ref", "layer_digests", "approval_token"],
    },
  },
  {
    name: "delete_image",
    description:
      "Delete an image from the registry. Requires an approval token from the gate layer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        image_ref: {
          type: "string",
          description: "Image reference to delete",
        },
        approval_token: {
          type: "string",
          description:
            "Approval token from the gate layer. Non-optional; verified before delete.",
        },
      },
      required: ["image_ref", "approval_token"],
    },
  },
  {
    name: "tag_image",
    description:
      "Create an alias for an existing image (e.g., promote sha256:abc... to 'latest'). Requires an approval token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source_ref: {
          type: "string",
          description: "Source image reference (usually a digest)",
        },
        target_ref: {
          type: "string",
          description: "Target tag (e.g., latest, v1.0.0)",
        },
        approval_token: {
          type: "string",
          description: "Approval token from the gate layer.",
        },
      },
      required: ["source_ref", "target_ref", "approval_token"],
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
      case "get_image_metadata":
        result = await getImageMetadata(args.image_ref);
        break;

      case "get_scan_results":
        result = await getScanResults(args.image_ref);
        break;

      case "push_image":
        result = await pushImage(
          args.image_ref,
          args.layer_digests,
          args.approval_token
        );
        break;

      case "delete_image":
        result = await deleteImage(args.image_ref, args.approval_token);
        break;

      case "tag_image":
        result = await tagImage(
          args.source_ref,
          args.target_ref,
          args.approval_token
        );
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
