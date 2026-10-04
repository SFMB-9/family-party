/** Private packs from S3, cached in the Lambda for a minute so a game night costs a handful of reads. */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { parsePrivatePack, type PackSource, type PrivatePack } from "./packs";

const s3 = new S3Client({});

export class S3Packs implements PackSource {
  private cache: { at: number; packs: PrivatePack[] } | null = null;

  constructor(
    private readonly bucket: string,
    private readonly ttlMs = 60_000,
  ) {}

  async list(): Promise<PrivatePack[]> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.packs;

    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: "packs/", ContinuationToken: token }));
      for (const o of page.Contents ?? []) if (o.Key?.endsWith(".json")) keys.push(o.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    const packs = await Promise.all(
      keys.map(async (key) => {
        const object = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        const parsed = parsePrivatePack(JSON.parse((await object.Body?.transformToString()) ?? "null"));
        // A broken file must not take the game down: log it (problems only, never the content) and skip it.
        if (!parsed.ok) console.warn(`skipping ${key}:`, parsed.errors.slice(0, 5));
        return parsed.ok ? [parsed.value] : [];
      }),
    );
    this.cache = { at: Date.now(), packs: packs.flat() };
    return this.cache.packs;
  }
}

/** No bucket configured: no private packs, the public game works as before. */
export const noPrivatePacks: PackSource = { list: async () => [] };
