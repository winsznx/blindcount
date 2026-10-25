import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";

/** Private object store. Keys are random and never exposed to clients. */
export interface ObjectStore {
  put(prefix: string, data: Uint8Array): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  healthy(): Promise<boolean>;
}

export class FileObjectStore implements ObjectStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!/^[a-z]+\/[0-9a-f]{2}\/[0-9a-f]{40}$/.test(key)) throw new Error("invalid storage key");
    return join(this.root, key);
  }

  async put(prefix: string, data: Uint8Array): Promise<string> {
    const id = randomBytes(20).toString("hex");
    const key = `${prefix}/${id.slice(0, 2)}/${id}`;
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { flag: "wx", mode: 0o600 });
    return key;
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async healthy(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      return (await stat(this.root)).isDirectory();
    } catch {
      return false;
    }
  }
}
