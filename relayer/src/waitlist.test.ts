import { mkdtempSync, readFileSync } from "node:fs";
import net from "node:net";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { imapAppend, normalizeEmail, Waitlist, WaitlistLimits, waitlistMessage } from "./waitlist.js";

describe("waitlist", () => {
  it("accepts plain addresses and lower-cases them", () => {
    expect(normalizeEmail("  Astrid@Example.COM ")).toBe("astrid@example.com");
    expect(normalizeEmail("a.b+waitlist@mail.example.co.uk")).toBe("a.b+waitlist@mail.example.co.uk");
  });
  it("refuses anything that could break a mail header", () => {
    for (const bad of ["", "astrid", "astrid@", "@example.com", "a b@example.com", "a@example", "a@example.com\r\nBcc: x@y.z", "\"a\"@example.com", "a@-x.com", 42, null, "a".repeat(250) + "@example.com"])
      expect(normalizeEmail(bad)).toBeNull();
  });
  it("stores each address once, survives a restart and notifies only for new ones", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "wl-")), "sub", "waitlist.jsonl");
    const notify = vi.fn(async () => {});
    const w = new Waitlist(file, notify);
    expect(w.add("a@example.com", "landing")).toBe("added");
    expect(w.add("a@example.com", "landing")).toBe("already");
    expect(w.add("b@example.com", "updates")).toBe("added");
    expect(notify).toHaveBeenCalledTimes(2);
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(Object.keys(lines[0]).sort()).toEqual(["at", "email", "source"]);
    const again = new Waitlist(file);
    expect(again.size).toBe(2);
    expect(again.add("b@example.com", "landing")).toBe("already");
  });
  it("keeps the signup when the mail fails", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "wl-")), "waitlist.jsonl");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = new Waitlist(file, async () => { throw new Error("smtp down"); });
    expect(w.add("c@example.com", "landing")).toBe("added");
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalled();
    expect(new Waitlist(file).size).toBe(1);
    err.mockRestore();
  });
  it("rate-limits per address and per day", () => {
    const l = new WaitlistLimits(2, 3);
    expect(l.take("ip", 0)).toBeNull();
    expect(l.take("ip", 1)).toBeNull();
    expect(l.take("ip", 2)).toMatch(/too many/);
    expect(l.take("ip", 3600_001)).toBeNull();
    expect(l.take("ip2", 3600_002)).toMatch(/busy/);
  });
});

/** A tiny IMAP server: greets, takes AUTHENTICATE PLAIN and one APPEND literal, records what it got. */
function fakeImap(opts: { pass: string }) {
  const got: { auth?: string; mailbox?: string; message?: string } = {};
  const server = net.createServer((s) => {
    let buf = Buffer.alloc(0), want = 0, authing = false;
    s.write("* OK IMAP4 ready\r\n");
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (want) { if (buf.length < want + 2) return; got.message = buf.subarray(0, want).toString(); buf = buf.subarray(want + 2); want = 0; s.write("a2 OK APPEND completed\r\n"); continue; }
        const i = buf.indexOf("\r\n"); if (i < 0) return;
        const line = buf.subarray(0, i).toString(); buf = buf.subarray(i + 2);
        if (authing) { authing = false; got.auth = Buffer.from(line, "base64").toString(); s.write(got.auth.endsWith(`\0${opts.pass}`) ? "a1 OK logged in\r\n" : "a1 NO [AUTHENTICATIONFAILED] wrong\r\n"); continue; }
        if (line === "a1 AUTHENTICATE PLAIN") { authing = true; s.write("+ \r\n"); continue; }
        const m = /^a2 APPEND "([^"]+)" \{(\d+)\}$/.exec(line);
        if (m) { got.mailbox = m[1]; want = Number(m[2]); s.write("+ go ahead\r\n"); continue; }
        if (line === "a3 LOGOUT") { s.write("* BYE\r\na3 OK\r\n"); s.end(); }
      }
    });
  });
  return new Promise<{ port: number; got: typeof got; close: () => void }>((ok) => server.listen(0, "127.0.0.1", () => ok({ port: (server.address() as net.AddressInfo).port, got, close: () => server.close() })));
}

describe("waitlist inbox delivery", () => {
  const entry = { email: "astrid@example.com", at: "2026-11-10T15:00:00.000Z", source: "landing" };
  it("logs in and appends the message to the mailbox", async () => {
    const srv = await fakeImap({ pass: "s3cret\"x" });
    await imapAppend(net.connect(srv.port, "127.0.0.1"), { user: "contact@covered.market", pass: "s3cret\"x", mailbox: "INBOX" }, waitlistMessage(entry, "contact@covered.market"));
    srv.close();
    expect(srv.got.auth).toBe("\0contact@covered.market\0s3cret\"x");
    expect(srv.got.mailbox).toBe("INBOX");
    expect(srv.got.message).toContain("Subject: Mainnet waitlist: astrid@example.com\r\n");
    expect(srv.got.message).toContain("Reply-To: astrid@example.com\r\n");
    expect(srv.got.message).toContain("To: contact@covered.market\r\n");
    expect(srv.got.message).toMatch(/\r\n\r\nastrid@example.com joined/);
  });
  it("fails on a wrong password instead of hanging", async () => {
    const srv = await fakeImap({ pass: "right" });
    await expect(imapAppend(net.connect(srv.port, "127.0.0.1"), { user: "u", pass: "wrong", mailbox: "INBOX" }, "x", 3000)).rejects.toThrow(/a1 NO/);
    srv.close();
  });
  it("refuses a mailbox name that could break the command", async () => {
    await expect(imapAppend(new PassThrough(), { user: "u", pass: "p", mailbox: "INBOX\"\r\na9 DELETE x" }, "x")).rejects.toThrow(/bad mailbox/);
  });
});
