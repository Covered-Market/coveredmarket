/** NEP-366 wire format between the web app and the relayer: base64 of the borsh-encoded SignedDelegate. */
import { SCHEMA, encodeSignedDelegate } from "@near-js/transactions";
import { deserialize } from "borsh";
import type { DelegateActionView } from "../metatx.js";

export function decodeSignedDelegate(b64: string): any {
  return deserialize((SCHEMA as any).SignedDelegate, Buffer.from(b64, "base64"));
}
export function encodeSignedDelegateB64(sd: any): string {
  return Buffer.from(encodeSignedDelegate(sd)).toString("base64");
}
/** The view the relay policy inspects. */
export function viewOf(sd: any): DelegateActionView {
  const d = sd.delegateAction;
  return {
    senderId: d.senderId,
    receiverId: d.receiverId,
    actions: d.actions.map((a: any) => {
      const fc = a.functionCall;
      if (!fc) return { methodName: "<not a function call>", args: {}, gas: 0n, deposit: 0n };
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(Buffer.from(fc.args).toString()); } catch {}
      return { methodName: fc.methodName, args, gas: BigInt(fc.gas), deposit: BigInt(fc.deposit) };
    }),
  };
}
