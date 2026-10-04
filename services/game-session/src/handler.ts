/**
 * Lambda entry point: wires the real adapters into the app and maps API Gateway events to it.
 * All behavior lives in app.ts (tested without AWS); this file is glue only.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { PACKS, catalogWith, defaultPicks, picksExist, selectQuestions } from "@family-party/question-bank";
import { createApp } from "./app";
import { ApiGatewayPush, DynamoConnections, DynamoRooms } from "./dynamo";
import { managementEndpoint } from "./endpoint";
import { verifyCode } from "./packs";
import { S3Packs, noPrivatePacks } from "./s3";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is not set`);
  return value;
};

const rooms = new DynamoRooms(required("ROOMS_TABLE"));
const connections = new DynamoConnections(required("CONNECTIONS_TABLE"));
// Created once per Lambda container, so its one-minute cache survives between requests.
const privatePacks = process.env.PACKS_BUCKET ? new S3Packs(process.env.PACKS_BUCKET) : noPrivatePacks;

/** $connect events carry the query string (?room=ABCD); the v2 type doesn't declare it. */
type WebsocketEvent = APIGatewayProxyWebsocketEventV2 & { queryStringParameters?: Record<string, string | undefined> };

export async function handler(event: WebsocketEvent): Promise<APIGatewayProxyResultV2> {
  const { routeKey, connectionId, domainName, stage } = event.requestContext;

  const app = createApp({
    rooms,
    connections,
    push: new ApiGatewayPush(managementEndpoint(domainName, stage)),
    now: () => Date.now(),
    randomInt: (max) => randomInt(max),
    randomToken: () => randomBytes(24).toString("base64url"),
    // Only hashes are stored: a leaked table doesn't let anyone impersonate a player.
    hash: (token) => createHash("sha256").update(token).digest("hex"),
    questions: (selection, extra) => selectQuestions(selection, [...PACKS, ...extra]),
    catalog: (extra) => catalogWith(extra),
    defaultPicks: () => defaultPicks(),
    picksExist: (picks, extra) => picksExist(picks, [...PACKS, ...extra]),
    privatePacks,
    verifyCode,
  });

  switch (routeKey) {
    case "$connect": {
      const accepted = await app.connect(connectionId, event.queryStringParameters?.room);
      return { statusCode: accepted ? 200 : 403 };
    }
    case "$disconnect":
      await app.disconnect(connectionId);
      return { statusCode: 200 };
    default:
      await app.message(connectionId, event.body);
      return { statusCode: 200 };
  }
}
