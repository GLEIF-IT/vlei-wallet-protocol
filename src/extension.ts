/** Extension entry: content-script bridge, background router, runtime glue and the shared protocol. */
export * from "./protocol.js";
export {
  createContentBridge,
  type ExtensionBridge,
  type ExtensionBridgeOptions,
  type LocalHandler,
  type LocalHandlers,
} from "./extension/bridge.js";
export {
  createBackgroundRouter,
  type BackgroundRouter,
  type BackgroundRouterOptions,
  type ProtocolHandler,
  type ProtocolHandlers,
  type RequestContext,
  type RouterResponse,
} from "./extension/router.js";
export {
  RUNTIME_CHANNEL,
  contextFromSender,
  createRuntimeListener,
  forwardViaRuntime,
  isRuntimeEnvelope,
  unwrapRouterResponse,
  wrapForRuntime,
  type RuntimeEnvelope,
  type RuntimeListenerOptions,
  type RuntimeSender,
} from "./extension/runtime.js";
