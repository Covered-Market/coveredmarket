/**
 * The mainnet waitlist behind POST /api/waitlist. Each new address is appended to a JSON-lines file on the relayer's
 * data volume (the record of who signed up) and, when IMAP is configured, also placed as a short message in the
 * waitlist inbox. Only the address, the time and the page it came from are kept: no IP address, no user agent.
 *
 * Why IMAP and not SMTP: DigitalOcean blocks outbound SMTP (ports 25, 465 and 587) from droplets, so the relayer
 * cannot send mail. It can log in to the inbox over IMAP (993) and APPEND the message there directly.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";

/** A plain address, lower-cased. Strict on purpose: it goes into a mail header, so no spaces, quotes or line breaks. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254) return null;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/.test(e) ? e : null;
}

/** Signups per client address per hour, and for the whole server per day. */
export class WaitlistLimits {
  private byIp = new Map<string, number[]>();
  private day: number[] = [];
  constructor(private perIpPerHour = 5, private perDay = 500) {}
  take(ip: string, now = Date.now()): string | null {
    const recent = (this.byIp.get(ip) ?? []).filter((t) => now - t < 3600_000);
    this.day = this.day.filter((t) => now - t < 86_400_000);
    if (recent.length >= this.perIpPerHour) return "too many signups from this address; try again later";
    if (this.day.length >= this.perDay) return "the waitlist is busy; try again tomorrow";
    this.byIp.set(ip, [...recent, now]); this.day.push(now);
    return null;
  }
}

export type Entry = { email: string; at: string; source: string };

export class Waitlist {
  private emails = new Set<string>();
  constructor(private file: string, private notify?: (e: Entry) => Promise<void>) {
    if (existsSync(file)) for (const line of readFileSync(file, "utf8").split("\n")) {
      try { const r = JSON.parse(line) as Entry; if (r.email) this.emails.add(r.email); } catch {}
    }
  }
  get size() { return this.emails.size; }
  /** Stores a new address and delivers the notification in the background. An address already on the list is not
   *  stored twice, and the caller answers the same either way, so the endpoint does not reveal who signed up. */
  add(email: string, source: string, now = new Date()): "added" | "already" {
    if (this.emails.has(email)) return "already";
    const entry: Entry = { email, at: now.toISOString(), source };
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(entry) + "\n");
    this.emails.add(email);
    this.notify?.(entry).catch((e) => console.error(new Date().toISOString(), "waitlist delivery failed:", (e as Error).message));
    return "added";
  }
}

/** The notification as an RFC 5322 message. Every header value is either fixed or a normalizeEmail() address. */
export function waitlistMessage(e: Entry, to: string, now = new Date()): string {
  return [
    `From: CoveredMarket waitlist <${to}>`,
    `To: ${to}`,
    `Reply-To: ${e.email}`,
    `Subject: Mainnet waitlist: ${e.email}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${to.split("@")[1] || "localhost"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `${e.email} joined the CoveredMarket mainnet waitlist at ${e.at} from the ${e.source} page.`,
    "",
    "Reply to this message to write to them. The full list is on the relayer in /data/waitlist.jsonl.",
    "",
  ].join("\r\n");
}

export type ImapLogin = { user: string; pass: string; mailbox: string };

/** Logs in (AUTHENTICATE PLAIN), APPENDs one message to `mailbox` and logs out, over an already-open connection. */
export function imapAppend(sock: Duplex, login: ImapLogin, message: string, timeoutMs = 20_000): Promise<void> {
  if (!/^[A-Za-z0-9 ._/-]{1,100}$/.test(login.mailbox)) return Promise.reject(new Error("bad mailbox name"));
  return new Promise((resolve, reject) => {
    let buf = "", step = 0, done = false;
    const finish = (err?: Error) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(); };
    const timer = setTimeout(() => finish(new Error("IMAP timed out")), timeoutMs);
    const send = (s: string) => sock.write(s);
    const body = Buffer.from(message, "utf8");
    // Each step waits for one server line: the greeting, a "+" continuation or a tagged reply.
    const onLine = (line: string) => {
      if (line.startsWith("* ") && step !== 0) return; // untagged data
      const tagged = /^(a\d) (OK|NO|BAD)\b/i.exec(line);
      if (tagged && tagged[2].toUpperCase() !== "OK") return finish(new Error(`IMAP ${tagged[1]} ${line.slice(3, 200)}`));
      switch (step) {
        case 0: if (!/^\* (OK|PREAUTH)/i.test(line)) return finish(new Error(`IMAP greeting: ${line.slice(0, 200)}`)); send("a1 AUTHENTICATE PLAIN\r\n"); step = 1; break;
        case 1: if (!line.startsWith("+")) return; send(Buffer.from(`\0${login.user}\0${login.pass}`).toString("base64") + "\r\n"); step = 2; break;
        case 2: if (!tagged) return; send(`a2 APPEND "${login.mailbox}" {${body.length}}\r\n`); step = 3; break;
        case 3: if (!line.startsWith("+")) return; sock.write(body); send("\r\n"); step = 4; break;
        case 4: if (!tagged) return; send("a3 LOGOUT\r\n"); step = 5; break;
        case 5: if (tagged) finish(); break;
      }
    };
    sock.on("data", (d: Buffer) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\r\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); onLine(l); } });
    sock.on("error", (e) => finish(e));
    sock.on("close", () => finish(step === 5 ? undefined : new Error("IMAP connection closed early")));
  });
}

/** Puts each signup in the waitlist inbox over IMAPS when IMAP_HOST, IMAP_USER and IMAP_PASS (or IMAP_PASS_B64) are set. */
export async function imapNotifier(env: NodeJS.ProcessEnv): Promise<((e: Entry) => Promise<void>) | undefined> {
  // IMAP_PASS_B64 is how deploys store it (any character survives compose's .env parsing); IMAP_PASS is the plain form.
  const pass = env.IMAP_PASS_B64 ? Buffer.from(env.IMAP_PASS_B64, "base64").toString("utf8") : env.IMAP_PASS;
  if (!env.IMAP_HOST || !env.IMAP_USER || !pass) return undefined;
  const tls = await import("node:tls");
  const host = env.IMAP_HOST, port = Number(env.IMAP_PORT ?? 993);
  const login = { user: env.IMAP_USER, pass, mailbox: env.IMAP_MAILBOX ?? "INBOX" };
  const to = env.WAITLIST_TO || env.IMAP_USER;
  return async (e) => {
    // Two tries: one dropped connection should not lose the notification (the file has it either way).
    for (let i = 0; ; i++) {
      try { return await imapAppend(tls.connect({ host, port, servername: host }), login, waitlistMessage(e, to)); }
      catch (err) { if (i >= 1) throw err; await new Promise((r) => setTimeout(r, 3000)); }
    }
  };
}
