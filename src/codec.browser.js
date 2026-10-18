// Used automatically by bundlers (Vite, esbuild, webpack) via the "browser" condition.
// Requires: npm install fflate
import { gzipSync, gunzipSync } from "fflate";
export const gzip = (u8) => gzipSync(u8);
export const gunzip = (u8) => gunzipSync(u8);
