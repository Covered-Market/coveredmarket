/**
 * Where an agent's keys live: one folder per site, files mode 0600.
 *
 *   $COVEREDMARKET_HOME (default ~/.coveredmarket)/<site host>/
 *     wallet-<name>.json      NEAR key, Bitcoin receive key, rescue keys not yet in a kit
 *     kits/<contract>/CV-<n>.json   each offer's rescue kit (the seller's Bitcoin-only exit)
 *
 * Nothing here leaves the machine. Lose a kit and that offer has no exit that works without NEAR.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WalletFile {
  accountId: string;
  /** ed25519:… NEAR secret key */
  nearKey: string;
  /** hex secp256k1 key for the Bitcoin receive address */
  btcKey: string;
  /** rescue keys made before create_offer, by public key: kept until their kit is written */
  pendingRescue: Record<string, string>;
  created: string;
}

export class Store {
  readonly dir: string;
  constructor(siteUrl: string, home = process.env.COVEREDMARKET_HOME ?? join(homedir(), ".coveredmarket")) {
    const host = new URL(siteUrl).host.replace(/[^a-z0-9.-]/gi, "_");
    this.dir = join(home, host);
  }
  private write(path: string, v: unknown) {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(path + ".tmp", JSON.stringify(v, null, 2), { mode: 0o600 });
    renameSync(path + ".tmp", path);
    chmodSync(path, 0o600);
  }
  walletPath(name: string) { return join(this.dir, `wallet-${name.replace(/[^a-z0-9_-]/gi, "_")}.json`); }
  loadWallet(name: string): WalletFile | null {
    const p = this.walletPath(name);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }
  saveWallet(name: string, w: WalletFile) { this.write(this.walletPath(name), w); }
  kitPath(contract: string, serial: number) { return join(this.dir, "kits", contract, `CV-${serial}.json`); }
  saveKit(contract: string, serial: number, kit: unknown) { const p = this.kitPath(contract, serial); this.write(p, kit); return p; }
  hasKit(contract: string, serial: number) { return existsSync(this.kitPath(contract, serial)); }
}
