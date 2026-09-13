import "server-only";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface StorageAdapter {
  save(tenantCode: string, file: File | Blob, ext: string): Promise<string>; // returns public path
  read(rel: string): Promise<Buffer>;
}

const root = () => path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

export const localStorageAdapter: StorageAdapter = {
  async save(tenantCode, file, ext) {
    const dir = path.join(root(), tenantCode);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
    await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
    return `/api/uploads/${tenantCode}/${name}`;
  },
  async read(rel) {
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    return readFile(path.join(root(), safe));
  },
};
