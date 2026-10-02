/**
 * Walking-skeleton WebSocket handler: no game yet, just plumbing.
 *
 *   $connect     → remember the connection
 *   $disconnect  → forget it
 *   $default     → broadcast the message to every connection
 *
 * One Lambda handles all three routes; API Gateway tells us which one
 * fired in `requestContext.routeKey`.
 */
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { expiresAt, makeEnvelope, managementEndpoint } from "./envelope";

const TABLE = process.env.CONNECTIONS_TABLE;
if (!TABLE) throw new Error("CONNECTIONS_TABLE env var is not set");

// Created once per Lambda container and reused across invocations (faster warm starts).
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> {
  const { routeKey, connectionId, domainName, stage } = event.requestContext;
  const now = Date.now();

  switch (routeKey) {
    case "$connect":
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: { connectionId, connectedAt: now, expiresAt: expiresAt(now) },
      }));
      break;

    case "$disconnect":
      await db.send(new DeleteCommand({ TableName: TABLE, Key: { connectionId } }));
      break;

    default: {
      const envelope = makeEnvelope(connectionId, event.body, now);
      await broadcast(managementEndpoint(domainName, stage), JSON.stringify(envelope));
    }
  }

  // For $connect, a non-2xx status would reject the connection.
  return { statusCode: 200 };
}

async function broadcast(endpoint: string, payload: string): Promise<void> {
  const api = new ApiGatewayManagementApiClient({ endpoint });

  // A Scan reads the whole table. Fine for a skeleton with a handful of
  // connections; the real game will look up connections by room instead.
  const { Items = [] } = await db.send(new ScanCommand({
    TableName: TABLE,
    ProjectionExpression: "connectionId",
  }));

  await Promise.all(Items.map(async ({ connectionId }) => {
    try {
      await api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: payload }));
    } catch (err) {
      // 410 Gone: the client vanished without a clean $disconnect (phone slept,
      // tab closed). Drop it so we stop trying.
      if (err instanceof GoneException) {
        await db.send(new DeleteCommand({ TableName: TABLE, Key: { connectionId } }));
      } else {
        throw err;
      }
    }
  }));
}
