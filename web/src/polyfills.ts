// near-js builds function-call arguments with Node's Buffer (action_creators.functionCall), which browsers
// lack. Without this every transaction from the app throws "Buffer is not defined". Imported first in main.tsx.
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;
