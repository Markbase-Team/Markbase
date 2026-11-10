// @markbase/llm — asking a model for a JSON answer.
//
// One capability, shared by whatever feature wants it, depending on nothing.
// Deliberately not a "provider abstraction": there is one provider today, and
// the plugin plan warns against building for plugins before the kernel exists.
// When a second provider turns up, THIS is the package that grows an interface.

export { chatJson, type ContentPart, type ChatMessage } from "./openrouter";
