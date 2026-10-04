/** Dev server only: locked private packs from a local folder outside the repo (PRIVATE_PACKS_DIR). */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePrivatePack, type PackSource } from "./packs";

export class FolderPacks implements PackSource {
  constructor(private readonly dir: string) {}

  async list() {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const packs = await Promise.all(
      files.map(async (file) => {
        const parsed = parsePrivatePack(JSON.parse(await readFile(join(this.dir, file), "utf8")));
        if (!parsed.ok) console.warn(`skipping ${file}:`, parsed.errors.slice(0, 5));
        return parsed.ok ? [parsed.value] : [];
      }),
    );
    return packs.flat();
  }
}
