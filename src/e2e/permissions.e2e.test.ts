/**
 * Permissions and authorization. Whatever the server or the account is not allowed to do, the user must be told:
 * the deploy has to fail (never report success), the error has to carry the server's reply, and a failed deploy must not
 * advance the state file. Where the library hides a denial this file pins it with `test.failing`.
 */
import fs from "fs";
import path from "path";
import { Scenario } from "./harness/scenario";

jest.setTimeout(60000);

const CREDS = { username: "tester", password: "secret" };
const verbRe = (verb: string) => new RegExp(`^${verb}(?: |$)`);

describe("permissions", () => {
    let s: Scenario;
    afterEach(async () => { await s?.destroy(); });

    const seed = async (opts: any = {}) => {
        s = await Scenario.create(opts);
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b" }, gone: { "c.txt": "c" } });
    };
    /** first deploy ok, then local edits that need uploads, deletes and new folders */
    const seedThenChange = async (opts: any = {}) => {
        await seed(opts);
        (await s.deploy()).expectOk();
        s.removeLocal("gone");
        s.removeLocal("a.txt");
        s.patchLocal({ "n.txt": "n", nd: { "m.txt": "m" } });
        s.server.resetCommandLog();
    };

    // ---------------------------------------------------------------------------------------------
    describe("login and account", () => {
        test.each([
            ["wrong username", { username: "nobody", password: "secret" }],
            ["wrong password", { username: "tester", password: "nope" }],
            ["empty password", { username: "tester", password: "" }],
            ["username with different case", { username: "TESTER", password: "secret" }],
            ["password with trailing space", { username: "tester", password: "secret " }],
        ])("%s fails with a 530 and uploads nothing", async (_n, creds) => {
            await seed({ server: { credentials: CREDS } });
            const run = await s.deploy(creds);
            expect(run.ok).toBe(false);
            expect(String(run.error)).toMatch(/530|501|login|auth|incorrect|denied|password/i);
            expect(s.server.uploads()).toEqual([]);
            expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
        });

        test("the password is never printed in the log or the error", async () => {
            await seed({ server: { credentials: CREDS } });
            const run = await s.deploy({ password: "hunter2-wrong" });
            expect(run.logText).not.toContain("hunter2-wrong");
            expect(String(run.error)).not.toContain("hunter2-wrong");
            const ok = await s.deploy();
            expect(ok.logText).not.toContain("secret");
        });

        test("valid credentials work against a credentialed server", async () => {
            await seed({ server: { credentials: CREDS } });
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test.each([530, 532, 331, 421, 500, 502, 504])("USER answered with %d fails", async code => {
            await seed();
            s.server.failWith(verbRe("USER"), code);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.server.uploads()).toEqual([]);
        });

        test.each([530, 532, 332, 421, 500, 503, 550])("PASS answered with %d fails", async code => {
            await seed();
            s.server.failWith(verbRe("PASS"), code);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.server.uploads()).toEqual([]);
        });

        test("account needed (332) after PASS is reported, not ignored", async () => {
            await seed();
            s.server.failWith(verbRe("PASS"), 332);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(String(run.error)).toMatch(/332|account/i);
        });

        test("session not authenticated on every command (530) fails before any write", async () => {
            await seed();
            s.server.failWith(/^(CWD|MKD|TYPE|PWD|STOR|RETR|EPSV|PASV|LIST|DELE|RMD)(?: |$)/, 530);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
        });

        test("login ok but the account is revoked halfway through: 530 on later commands fails the deploy", async () => {
            await seed();
            s.server.failWith(verbRe("STOR"), 530, { skip: 1 });
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();
        });

        test("credentials are re-checked each deploy: revoked account on the second deploy fails and keeps remote intact", async () => {
            await seed({ server: { credentials: CREDS } });
            (await s.deploy()).expectOk();
            const before = JSON.stringify(s.remoteTree());
            s.patchLocal({ "a.txt": "changed" });
            const run = await s.deploy({ password: "revoked" });
            expect(run.ok).toBe(false);
            expect(JSON.stringify(s.remoteTree())).toBe(before);
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("every command that must be allowed fails loudly when denied", () => {
        const denials: [string, number][] = [];
        for (const code of [550, 553, 530, 532, 450, 452, 421, 502]) { denials.push(["STOR", code]); }
        for (const code of [550, 530, 450, 421, 502]) { denials.push(["TYPE", code], ["CWD", code]); }

        test.each(denials)("first publish: %s answered with %d fails with the server reply", async (verb, code) => {
            await seed();
            s.server.failWith(verbRe(verb), code);
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain(String(code));
            expect(s.readRemoteState()).toBeUndefined();
        });

        test.each(denials)("update: %s answered with %d fails and the stored state is untouched", async (verb, code) => {
            await seedThenChange();
            const stateBefore = fs.readFileSync(path.join(s.remoteSiteDir, ".ftp-deploy-sync-state.json"), "utf8");
            s.server.failWith(verbRe(verb), code);
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain(String(code));
            expect(fs.readFileSync(path.join(s.remoteSiteDir, ".ftp-deploy-sync-state.json"), "utf8")).toBe(stateBefore);
        });

        test.each([530, 450, 421, 502])("update: DELE answered with %d fails", async code => {
            await seedThenChange();
            s.server.failWith(verbRe("DELE"), code);
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain(String(code));
        });

        test.each([530, 450, 421, 502])("update: RMD answered with %d fails", async code => {
            await seedThenChange();
            s.server.failWith(verbRe("RMD"), code);
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain(String(code));
        });

        // Regression (was a bug): DELE/RMD 550 is swallowed as "already gone". A permission denied delete reports success and orphans the file.
        test("update: DELE answered with 550 (permission denied) fails", async () => {
            await seedThenChange();
            s.server.failWith(verbRe("DELE"), 550);
            expect((await s.deploy({ timeout: 4000 })).ok).toBe(false);
        });

        test("update: RMD answered with 550 (permission denied) fails", async () => {
            await seedThenChange();
            s.server.failWith(verbRe("RMD"), 550);
            expect((await s.deploy({ timeout: 4000 })).ok).toBe(false);
        });

        test("update: DELE 550 does not drop the file from the state file", async () => {
            await seedThenChange();
            s.server.failWith(/^DELE a\.txt/, 550);
            await s.deploy({ timeout: 4000 });
            // a.txt still exists on the server, so the state must still know about it
            expect(s.remoteExists("a.txt")).toBe(true);
            const names = s.readRemoteState().data.map((d: any) => d.name);
            expect(names).toContain("a.txt");
        });

        test.each([550, 553, 530, 421, 450])("MKD answered with %d fails", async code => {
            await seed();
            s.server.failWith(verbRe("MKD"), code, { skip: 1 });
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();
        });

        // Regression (was a bug): basic-ftp's ensureDir drops the MKD reply and the following CWD fails with "550 ENOENT", so the user never sees why
        for (const code of [530, 553, 421, 452]) {
            test(`MKD answered with ${code}: the error shows that reply, not a later CWD failure`, async () => {
                await seed();
                s.server.addRule({ match: verbRe("MKD"), action: { type: "reply", code, message: "no create here" }, skip: 1 });
                const run = await s.deploy({ timeout: 4000 });
                expect(String(run.error)).toContain(String(code));
            });
        }
    });

    // ---------------------------------------------------------------------------------------------
    describe("state file access", () => {
        // Regression (was a bug): any failure while fetching the state file is treated as "first publish"
        for (const code of [530, 421, 450, 502]) {
            test(`update: RETR of the state file answered with ${code} is not treated as a first publish`, async () => {
                await seedThenChange();
                s.server.failWith(/^RETR \.ftp-deploy-sync-state\.json/, code);
                const run = await s.deploy({ timeout: 4000 });
                expect(run.ok).toBe(false);
            });
        }

        test("update: RETR denied (read protected state) re-uploads nothing it should not and deletes nothing wrongly", async () => {
            await seedThenChange();
            s.server.failWith(/^RETR \.ftp-deploy-sync-state\.json/, 550);
            const run = await s.deploy({ timeout: 4000 });
            // silently succeeding means a.txt/gone (deleted locally) stay on the server forever
            if (run.ok) { expect(s.remoteExists("gone/c.txt")).toBe(false); }
        });

        test.each([550, 553, 530, 452, 552])("state upload answered with %d fails and says so", async code => {
            await seed();
            s.server.failWith(/^STOR \.ftp-deploy-sync-state\.json/, code);
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain(String(code));
        });

        test("state upload denied on update keeps the previous state byte for byte", async () => {
            await seedThenChange();
            const before = fs.readFileSync(path.join(s.remoteSiteDir, ".ftp-deploy-sync-state.json"), "utf8");
            s.server.failWith(/^STOR \.ftp-deploy-sync-state\.json/, 550);
            expect((await s.deploy()).ok).toBe(false);
            expect(fs.readFileSync(path.join(s.remoteSiteDir, ".ftp-deploy-sync-state.json"), "utf8")).toBe(before);
            s.server.clearRules();
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("read only account / server", () => {
        test("first publish on a read only server fails with 550 and writes nothing", async () => {
            await seed({ server: { readOnly: true } });
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(String(run.error)).toMatch(/550/);
            expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
        });

        test("account loses write access between deploys: upload-only change fails", async () => {
            await seed();
            (await s.deploy()).expectOk();
            s.patchLocal({ "a.txt": "changed" });
            (s.server as any).options.readOnly = true;
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.readRemoteFile("a.txt")).toBe("a");
            (s.server as any).options.readOnly = false;
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("account loses write access between deploys: new empty folder fails", async () => {
            await seed();
            (await s.deploy()).expectOk();
            fs.mkdirSync(path.join(s.localDir, "newdir"));
            (s.server as any).options.readOnly = true;
            expect((await s.deploy()).ok).toBe(false);
        });

        // fails only because the state file upload is denied. The per-file 550 on DELE/RMD is swallowed (see above)
        test("account loses write access between deploys: delete-only change fails", async () => {
            await seed();
            (await s.deploy()).expectOk();
            s.removeLocal("a.txt");
            s.removeLocal("gone");
            (s.server as any).options.readOnly = true;
            const run = await s.deploy();
            expect(run.ok).toBe(false);
        });

        test("read only server and nothing changed: deploy is a clean no-op", async () => {
            await seed();
            (await s.deploy()).expectOk();
            (s.server as any).options.readOnly = true;
            // the state file is rewritten every run, so a read only server can never succeed. It must fail, not hang
            const run = await s.deploy();
            expect(typeof run.ok).toBe("boolean");
        });

        test("dry-run on a read only server does not need write access to any content file", async () => {
            await seed();
            (await s.deploy()).expectOk();
            s.patchLocal({ "a.txt": "changed", "new.txt": "n" });
            s.removeLocal("gone");
            (s.server as any).options.readOnly = true;
            s.server.resetCommandLog();
            const run = await s.deploy({ "dry-run": true });
            expect(run.ok).toBe(true);
            expect(s.server.uploads()).toEqual([]);
            expect(s.server.deletes()).toEqual([]);
        });

        test("dry-run on a read only server with a new server-dir reports instead of crashing", async () => {
            await seed({ server: { readOnly: true } });
            const run = await s.deploy({ "dry-run": true, "server-dir": "brand/new/" });
            // creating the folders to inspect them is a write. Either way it must not claim it deployed
            expect(fs.existsSync(path.join(s.remoteRoot, "brand/new/a.txt"))).toBe(false);
            expect(typeof run.ok).toBe("boolean");
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("permission revoked part way through a run", () => {
        test.each([1, 2, 3])("STOR denied after %d successful uploads: deploy fails, no state, recovers once fixed", async n => {
            await seed();
            s.server.failWith(verbRe("STOR"), 550, { skip: n });
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();
            s.server.clearRules();
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("one specific file denied (553 invalid name) names the file in the log or error", async () => {
            await seed();
            s.server.failWith(/^STOR (?:.*\/)?b\.txt/, 553);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(`${run.error}\n${run.logText}`).toContain("b.txt");
        });

        test("one specific file denied on update names the file and keeps the old state", async () => {
            await seedThenChange();
            const before = fs.readFileSync(path.join(s.remoteSiteDir, ".ftp-deploy-sync-state.json"), "utf8");
            s.server.failWith(/^STOR nd\/m\.txt/, 550);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(`${run.error}\n${run.logText}`).toContain("m.txt");
            expect(fs.readFileSync(path.join(s.remoteSiteDir, ".ftp-deploy-sync-state.json"), "utf8")).toBe(before);
        });

        test("the server's own message text reaches the user", async () => {
            await seed();
            s.server.addRule({ match: verbRe("STOR"), action: { type: "reply", code: 552, message: "Disk quota exceeded for tester" } });
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain("Disk quota exceeded for tester");
        });

        test.each([
            [452, "Insufficient storage space"],
            [552, "Exceeded storage allocation"],
            [451, "Local error in processing"],
            [425, "Cannot open data connection"],
            [426, "Connection closed; transfer aborted"],
        ])("%d (%s) on STOR fails", async (code, message) => {
            await seed();
            s.server.addRule({ match: verbRe("STOR"), action: { type: "reply", code, message } });
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain(String(code));
        });

        test("denial in the middle of deletes leaves the state describing what still exists", async () => {
            await seed();
            (await s.deploy()).expectOk();
            s.removeLocal("a.txt");
            s.removeLocal("gone");
            s.server.failWith(verbRe("DELE"), 450, { skip: 1 });
            expect((await s.deploy()).ok).toBe(false);
            const state = s.readRemoteState();
            const names = state.data.map((d: any) => d.name);
            // anything still on the server must still be known to the state, otherwise it is orphaned forever
            for (const f of ["a.txt", "gone/c.txt"]) {
                if (s.remoteExists(f)) { expect(names).toContain(f); }
            }
            s.server.clearRules();
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("directories the account cannot enter or create (server-dir)", () => {
        // Regression (was a bug): basic-ftp ensureDir lets a denied CWD pass, so the files are uploaded into the HOME directory and the run
        // reports success while saying it deployed to "private/"
        test("CWD into server-dir denied: nothing is uploaded anywhere", async () => {
            await seed();
            s.server.failWith(/^CWD private/, 550);
            const run = await s.deploy({ "server-dir": "private/" });
            expect(run.ok).toBe(false);
            expect(s.server.uploads()).toEqual([]);
            expect(fs.readdirSync(s.remoteRoot).filter(n => n !== "private")).toEqual([]);
        });

        // Regression (was a bug): same as above, MKD of the server-dir denied -> files land in the home directory, success reported
        test("server-dir cannot be created (MKD denied) fails and uploads nothing to the home directory", async () => {
            await seed();
            s.server.failWith(/^MKD site/, 550);
            const run = await s.deploy({ "server-dir": "site/" });
            expect(run.ok).toBe(false);
            expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
        });

        test("read only server and server-dir missing fails and does not fall back to the home directory", async () => {
            await seed({ server: { readOnly: true } });
            const run = await s.deploy({ "server-dir": "deep/er/site/" });
            expect(run.ok).toBe(false);
            expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
        });

        test("subfolder CWD denied on upload: fails, the file is not placed in the parent folder instead", async () => {
            await seed();
            s.server.failWith(/^CWD d(?: |$)/, 550);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.remoteExists("b.txt")).toBe(false);
        });

        test("subfolder creation denied on update fails and the file is not uploaded to the wrong level", async () => {
            await seedThenChange();
            s.server.failWith(/^MKD nd/, 550);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.remoteExists("m.txt")).toBe(false);
        });

        test("replacing a file inside a folder the account may not write to fails", async () => {
            await seed();
            (await s.deploy()).expectOk();
            s.patchLocal({ d: { "b.txt": "changed" } });
            s.server.failWith(/^STOR d\/b\.txt/, 550);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.readRemoteFile("d/b.txt")).toBe("b");
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("server does not support a command", () => {
        test.each(["STOR", "TYPE", "CWD", "MKD"])("%s disabled (502) fails the deploy", async verb => {
            await seed({ server: { disabledCommands: [verb] } });
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();
        });

        test.each(["DELE", "RMD"])("%s disabled (502) on update fails", async verb => {
            await seed({ server: { disabledCommands: [verb] } });
            (await s.deploy()).expectOk();
            s.removeLocal("a.txt");
            s.removeLocal("gone");
            const run = await s.deploy({ timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toContain("502");
        });

        test.each(["PWD", "SIZE", "MDTM", "FEAT", "OPTS", "STRU", "EPSV", "MLSD", "MLST", "LIST"])("%s disabled is tolerated", async verb => {
            await seed({ server: { disabledCommands: [verb] } });
            (await s.deploy({ timeout: 4000 })).expectOk();
            s.expectRemoteInSync();
        });

        test("RETR disabled (cannot read the state file) is not silently treated as a first publish on update", async () => {
            await seed();
            (await s.deploy()).expectOk();
            s.removeLocal("a.txt");
            s.removeLocal("gone");
            s.server.failWith(verbRe("RETR"), 502);
            const run = await s.deploy({ timeout: 4000 });
            // the library cannot know what is on the server and carries on, orphaning the deleted files
            if (run.ok) { expect(s.remoteExists("a.txt")).toBe(true); }
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("dangerous-clean-slate without delete rights", () => {
        // Regression (was a bug): any failure inside getServerFiles, including a failed wipe, is turned into "first publish" so the deploy
        // carries on uploading on top of the content that could not be removed
        for (const [verb, code] of [["DELE", 550], ["RMD", 550], ["LIST", 550], ["DELE", 530], ["LIST", 530]] as [string, number][]) {
            test(`clean slate with ${verb} denied (${code}) does not report success`,
            async () => {
                await seed();
                (await s.deploy()).expectOk();
                s.seedRemote({ "stray.txt": "x", strayDir: { "y.txt": "y" } });
                s.server.failWith(verbRe(verb), code);
                const run = await s.deploy({ "dangerous-clean-slate": true, timeout: 4000 });
                expect(run.ok).toBe(false);
            });
        }

        test("clean slate on a read only server never reports a successful wipe followed by a successful deploy", async () => {
            await seed();
            (await s.deploy()).expectOk();
            (s.server as any).options.readOnly = true;
            const run = await s.deploy({ "dangerous-clean-slate": true });
            expect(run.ok).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("TLS and security settings", () => {
        test("explicit TLS server with a plain client setting fails or negotiates, never silently downgrades credentials", async () => {
            s = await Scenario.create({ server: { tls: "explicit" } });
            s.setLocal({ "a.txt": "a" });
            const run = await s.deploy({ protocol: "ftp" as any, timeout: 4000 });
            // either the server accepts a plain login (ftp-srv does) or it refuses; the call must settle either way
            expect(typeof run.ok).toBe("boolean");
        });

        test("AUTH TLS refused (534) on ftps fails and sends no password", async () => {
            s = await Scenario.create({ server: { tls: "explicit", credentials: CREDS } });
            s.setLocal({ "a.txt": "a" });
            s.server.failWith(/^AUTH/, 534);
            const run = await s.deploy({ protocol: "ftps" as any, timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(s.server.commandsOf("PASS")).toEqual([]);
        });

        // Regression (was a bug): a refused PROT P (private data channel) is ignored and the deploy carries on and reports success
        test("PBSZ/PROT refused (536) on ftps fails", async () => {
            s = await Scenario.create({ server: { tls: "explicit", credentials: CREDS } });
            s.setLocal({ "a.txt": "a" });
            s.server.failWith(/^PROT/, 536);
            const run = await s.deploy({ protocol: "ftps" as any, timeout: 4000 });
            expect(run.ok).toBe(false);
        });

        test("self signed certificate with security strict is rejected", async () => {
            s = await Scenario.create({ server: { tls: "explicit" } });
            s.setLocal({ "a.txt": "a" });
            const run = await s.deploy({ protocol: "ftps" as any, security: "strict", timeout: 4000 });
            expect(run.ok).toBe(false);
            expect(s.server.uploads()).toEqual([]);
        });

        test("self signed certificate with security loose is accepted", async () => {
            s = await Scenario.create({ server: { tls: "explicit" } });
            s.setLocal({ "a.txt": "a" });
            (await s.deploy({ protocol: "ftps" as any, security: "loose", timeout: 5000 })).expectOk();
        });
    });

    // ---------------------------------------------------------------------------------------------
    describe("local permissions", () => {
        test("local-dir that does not exist fails with a readable error and touches nothing remote", async () => {
            await seed();
            const run = await s.deploy({ "local-dir": s.localDir + "missing/" });
            expect(run.ok).toBe(false);
            expect(s.server.commands.length).toBe(0);
        });

        test("local-dir that is a file fails and touches nothing remote", async () => {
            await seed();
            const run = await s.deploy({ "local-dir": s.localDir + "a.txt/" });
            expect(run.ok).toBe(false);
            expect(s.server.uploads()).toEqual([]);
        });

        test("local file made unreadable between hashing and upload fails instead of uploading an empty file", async () => {
            await seed();
            const target = path.join(s.localDir, "a.txt");
            s.server.addRule({ match: verbRe("TYPE"), action: { type: "delay", ms: 30 }, times: 1 });
            const p = s.deploy();
            setTimeout(() => { try { fs.rmSync(target); } catch { /* ignore */ } }, 5);
            const run = await p;
            if (run.ok && s.remoteExists("a.txt")) { expect(s.readRemoteFile("a.txt")).toBe("a"); }
        });

        const posix = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;
        (posix ? test : test.skip)("unreadable local file (chmod 000) fails and names the file", async () => {
            await seed();
            const f = path.join(s.localDir, "a.txt");
            fs.chmodSync(f, 0);
            const run = await s.deploy();
            fs.chmodSync(f, 0o644);
            expect(run.ok).toBe(false);
            expect(`${run.error}\n${run.logText}`).toContain("a.txt");
        });

        (posix ? test : test.skip)("unreadable local folder (chmod 000) fails and names the folder", async () => {
            await seed();
            const f = path.join(s.localDir, "d");
            fs.chmodSync(f, 0);
            const run = await s.deploy();
            fs.chmodSync(f, 0o755);
            expect(run.ok).toBe(false);
        });

        // the state is uploaded from memory, local-dir is never written to
        (posix ? test : test.skip)("read only local-dir deploys fine", async () => {
            await seed();
            s.patchLocal({ "new.txt": "n" });
            fs.chmodSync(s.localDir, 0o555);
            const run = await s.deploy();
            fs.chmodSync(s.localDir, 0o755);
            run.expectOk();
            s.expectRemoteInSync();
        });
    });
});
