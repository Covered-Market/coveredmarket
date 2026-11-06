/**
 * Pay a deposit straight from a Bitcoin browser wallet, when one is installed. Each wallet injects its own
 * provider; we only ask it to send `sats` to one address and read back the txid. The user approves in the
 * wallet. Test networks differ between wallets, and our testnet light client follows *testnet3*: where a wallet
 * tells us its network we check it, otherwise the button says which network to select.
 */
import { CFG } from "./near";

export interface BtcWallet { id: string; name: string; checksNetwork: boolean; send(address: string, sats: number): Promise<string> }
const w = window as any;
const isMain = () => CFG.mode === "mainnet";
const txidOf = (r: any): string => {
  const t = typeof r === "string" ? r : r?.result?.txid ?? r?.result?.txId ?? r?.txid ?? r?.txId ?? r?.result;
  if (typeof t !== "string" || !/^[0-9a-f]{64}$/i.test(t)) throw new Error(r?.error?.message ?? "the wallet did not return a transaction id");
  return t;
};

export function detectBtcWallets(): BtcWallet[] {
  const out: BtcWallet[] = [];
  if (w.unisat) out.push({
    id: "unisat", name: "UniSat", checksNetwork: true,
    async send(address, sats) {
      const want = isMain() ? "BITCOIN_MAINNET" : "BITCOIN_TESTNET";
      try { const c = await w.unisat.getChain?.(); if (c?.enum && c.enum !== want) await w.unisat.switchChain(want); }
      catch { const n = await w.unisat.getNetwork?.(); const wantN = isMain() ? "livenet" : "testnet"; if (n && n !== wantN) await w.unisat.switchNetwork(wantN); }
      await w.unisat.requestAccounts();
      return txidOf(await w.unisat.sendBitcoin(address, sats));
    },
  });
  const okx = isMain() ? w.okxwallet?.bitcoin : w.okxwallet?.bitcoinTestnet;
  if (okx) out.push({ id: "okx", name: "OKX Wallet", checksNetwork: true, async send(address, sats) { await okx.connect?.(); return txidOf(await okx.sendBitcoin(address, sats)); } });
  if (w.LeatherProvider) out.push({
    id: "leather", name: "Leather", checksNetwork: true,
    async send(address, sats) { return txidOf(await w.LeatherProvider.request("sendTransfer", { recipients: [{ address, amount: String(sats) }], network: isMain() ? "mainnet" : "testnet" })); },
  });
  const xv = w.XverseProviders?.BitcoinProvider ?? w.BitcoinProvider;
  if (xv?.request) out.push({
    id: "xverse", name: "Xverse", checksNetwork: false,
    async send(address, sats) { const r = await xv.request("sendTransfer", { recipients: [{ address, amount: sats }] }); if (r?.error) throw new Error(r.error.message ?? "rejected"); return txidOf(r); },
  });
  return out;
}
