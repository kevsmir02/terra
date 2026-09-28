// The editor stack's entry into LSP. Kept apart from index.ts so the session
// manager, and the store subscription it opens, stay out of the eager graph.
export {
  lspFormatDocument,
  notifyDocumentSaved,
} from "./lib/sessionManager";
export { useLspExtension } from "./lib/useLspExtension";
