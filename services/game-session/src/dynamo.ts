/** DynamoDB + API Gateway adapters for the ports. */
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { upgradeState } from "@family-party/game-core";
import type { ServerMessage } from "@family-party/protocol";
import type { Connection, ConnectionRepo, Push, Room, RoomRepo } from "./ports";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ROOM_TTL_SECONDS = 12 * 60 * 60;        // idle rooms disappear after 12h
const CONNECTION_TTL_SECONDS = 12 * 60 * 60;  // safety net for missed $disconnects
const nowSeconds = () => Math.floor(Date.now() / 1000);
const ttl = (seconds: number) => nowSeconds() + seconds;

/**
 * DynamoDB's TTL sweep is lazy: an expired item can still be read for hours, even days, until
 * AWS gets around to deleting it. So a room past its expiresAt counts as gone, here, not when
 * the item disappears.
 */
export const isExpired = (item: { expiresAt?: unknown }, now = nowSeconds()) =>
  typeof item.expiresAt === "number" && item.expiresAt <= now;

/**
 * Room item: { roomCode, version, data, expiresAt }.
 * `data` is the room as one JSON string: GameState has nested maps and arrays that are
 * simpler to store whole than to map onto DynamoDB types, and we never query inside it.
 */
export class DynamoRooms implements RoomRepo {
  constructor(private readonly table: string) {}

  async get(code: string): Promise<Room | null> {
    // ConsistentRead: optimistic locking needs the latest version, not a possibly stale copy.
    const { Item } = await db.send(new GetCommand({ TableName: this.table, Key: { roomCode: code }, ConsistentRead: true }));
    if (!Item || isExpired(Item)) return null;
    const data = JSON.parse(Item.data as string) as Omit<Room, "code" | "version">;
    // Rooms outlive deploys (12 h TTL): bring state written by older code up to date.
    return { ...data, state: upgradeState(data.state), code, version: Item.version as number };
  }

  async create(room: Room): Promise<boolean> {
    // A new room may take the code of an expired one that the TTL sweep hasn't deleted yet.
    return this.write(room, 0, "attribute_not_exists(roomCode) OR expiresAt <= :now", { ":now": nowSeconds() });
  }

  async save(room: Room): Promise<boolean> {
    return this.write(room, room.version + 1, "version = :expected", { ":expected": room.version });
  }

  private async write(room: Room, version: number, condition: string, values?: Record<string, unknown>) {
    const { code, version: _ignored, ...data } = room;
    try {
      await db.send(new PutCommand({
        TableName: this.table,
        Item: { roomCode: code, version, data: JSON.stringify(data), expiresAt: ttl(ROOM_TTL_SECONDS) },
        ConditionExpression: condition,
        ...(values && { ExpressionAttributeValues: values }),
      }));
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }
}

export class DynamoConnections implements ConnectionRepo {
  constructor(private readonly table: string) {}

  async put(conn: Connection) {
    await db.send(new PutCommand({ TableName: this.table, Item: { ...conn, expiresAt: ttl(CONNECTION_TTL_SECONDS) } }));
  }

  async get(connectionId: string) {
    const { Item } = await db.send(new GetCommand({ TableName: this.table, Key: { connectionId } }));
    return (Item as Connection | undefined) ?? null;
  }

  async delete(connectionId: string) {
    await db.send(new DeleteCommand({ TableName: this.table, Key: { connectionId } }));
  }

  /** Uses the byRoom index instead of scanning the whole table. */
  async listByRoom(roomCode: string) {
    const { Items = [] } = await db.send(new QueryCommand({
      TableName: this.table,
      IndexName: "byRoom",
      KeyConditionExpression: "roomCode = :r",
      ExpressionAttributeValues: { ":r": roomCode },
    }));
    return Items as Connection[];
  }
}

export class ApiGatewayPush implements Push {
  private readonly client: ApiGatewayManagementApiClient;
  constructor(endpoint: string) {
    this.client = new ApiGatewayManagementApiClient({ endpoint });
  }

  async send(connectionId: string, message: ServerMessage): Promise<"ok" | "gone"> {
    try {
      await this.client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: JSON.stringify(message) }));
      return "ok";
    } catch (err) {
      if (err instanceof GoneException) return "gone";
      throw err;
    }
  }
}
