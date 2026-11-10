// Server-only entrypoint: Gmail/OAuth logic + token storage. Holds secrets
// (service-role key, Google client secret, TOKEN_ENC_KEY) and uses node:crypto,
// so it must never be imported from a Client Component.
export * from "./accounts";
export * from "./gmail";
export * from "./oauth";
export * from "./unsubscribe";
export { encryptToken, decryptToken } from "./crypto";
