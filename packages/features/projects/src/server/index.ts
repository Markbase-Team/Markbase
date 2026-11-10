// The projects feature's server layer: what its route modules need that the
// shared data layer in @markbase/protocol does not already hold. Project
// secrets live here because they are the one thing of the board's that is
// encrypted at rest, and the key for that is read from the server's env.
export {
  createSecret,
  deleteSecret,
  listSecrets,
  revealProjectSecrets,
  revealSecret,
  updateSecret,
  type SecretMeta,
} from "./secrets";
export { isSecretsConfigured } from "./secrets-crypto";
