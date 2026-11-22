// The shape of an agent's config file: any JSON value, mostly not ours. The
// installers in this package merge into these files and must keep every
// setting and hook they did not write.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
