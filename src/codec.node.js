import { gzipSync, gunzipSync } from "node:zlib";
export const gzip = (u8) => new Uint8Array(gzipSync(u8));
export const gunzip = (u8) => new Uint8Array(gunzipSync(u8));
