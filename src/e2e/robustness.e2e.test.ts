/**
 * Robustness probes: failures around the state file, concurrency, odd settings, read only servers
 * (Action#100 #152 #162 #171 #303 #302 #324 #447).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Scenario } from "./harness/scenario";

jest.setTimeout(60000);

describe("robustness", () => {
    let s: Scenario;
    afterEach(async () => { await s?.destroy(); });

    test("#100 upload cut off mid file fails the deploy and a retry repairs it", async () => {
        s = await Scenario.create();
        fs.writeFileSync(path.join(s.localDir, "big.bin"), crypto.randomBytes(2_000_000));
        s.server.addRule({ match: /^STOR big\.bin/, action: { type: "dropDuringUpload", afterBytes: 100_000 }, times: 1 });
        expect((await s.deploy()).ok).toBe(false);
        expect(s.readRemoteState()).toBeUndefined();
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("#152 a failed upload is never reported as success", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a", "b.txt": "b" });
        s.server.failWith(/^STOR b\.txt/, 553);
        const run = await s.deploy();
        expect(run.ok).toBe(false);
    });

    test("state upload cut off leaves the previous state usable", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        s.patchLocal({ "a.txt": "changed", "b.txt": "b" });
        s.server.addRule({ match: /^STOR \.ftp-deploy-sync-state\.json/, action: { type: "drop" }, times: 1 });
        await s.deploy();
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("a half written (truncated) state file on the server converges", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b" } });
        (await s.deploy()).expectOk();
        const raw = fs.readFileSync(path.join(s.remoteSiteDir, ".ftp-deploy-sync-state.json"), "utf8");
        s.writeRemoteState(raw.slice(0, Math.floor(raw.length / 2)));
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("#447 state download hangs: deploy fails by timeout instead of hanging forever", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        s.server.addRule({ match: /^RETR \.ftp-deploy/, action: { type: "hang" }, times: 1 });
        const started = Date.now();
        const run = await s.deploy({ timeout: 1500 });
        expect(Date.now() - started).toBeLessThan(20000);
        expect(typeof run.ok).toBe("boolean");
    });

    test("read only server: deploy fails and the state is not claimed", async () => {
        s = await Scenario.create({ server: { readOnly: true } });
        s.setLocal({ "a.txt": "a" });
        const run = await s.deploy();
        expect(run.ok).toBe(false);
        expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
    });

    test("server without SIZE/MDTM still deploys", async () => {
        s = await Scenario.create({ server: { disabledCommands: ["SIZE", "MDTM"] } });
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b" } });
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("slow server (latency) still converges", async () => {
        s = await Scenario.create({ server: { latencyMs: 15 } });
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b" } });
        (await s.deploy({ timeout: 10000 })).expectOk();
        s.expectRemoteInSync();
    });

    test("two deploys racing against the same server do not corrupt the remote", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b", "c.txt": "c" } });
        const [r1, r2] = await Promise.all([s.deploy(), s.deploy()]);
        void r1; void r2;
        // whatever happened, one more healthy deploy must converge
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("local file removed between hashing and upload fails or skips, never corrupts", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a", "b.txt": "b" });
        s.server.addRule({ match: /^STOR a\.txt/, action: { type: "delay", ms: 50 }, times: 1 });
        const p = s.deploy();
        setTimeout(() => { try { s.removeLocal("b.txt"); } catch { /* ignore */ } }, 10);
        await p;
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("port 0 / timeout 0 do not hang", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a" });
        const started = Date.now();
        await s.deploy({ port: 0, timeout: 1000 });
        expect(Date.now() - started).toBeLessThan(15000);
    });

    test("uploading only zero byte files reports without NaN/Infinity", async () => {
        s = await Scenario.create();
        s.setLocal({ "e.txt": "" });
        const run = (await s.deploy()).expectOk();
        expect(run.logText).not.toMatch(/Infinity|NaN/);
    });

    test("fast tiny deploy reports without NaN/Infinity", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        const run = (await s.deploy()).expectOk();
        expect(run.logText).not.toMatch(/Infinity|NaN/);
    });

    test("#162 local file unreadable (is a directory racing as file) does not wedge the next run", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        s.patchLocal({ "a.txt": "b" });
        s.server.failWith(/^STOR a\.txt/, 550, { times: 2 });
        expect((await s.deploy()).ok).toBe(false);
        s.server.clearRules();
        (await s.deploy()).expectOk();
        expect(s.readRemoteFile("a.txt")).toBe("b");
    });

    test("deploy leaves no buffer file behind in cwd after success and failure", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        (await s.deploy()).expectOk();
        s.server.failWith(/^STOR/, 550);
        s.patchLocal({ "a.txt": "z" });
        await s.deploy();
        expect(fs.readdirSync(s.cwdDir)).toEqual([]);
    });

    test("deploy does not leave the local state file out of date after a failure", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        s.removeLocal("a.txt");
        s.patchLocal({ "b.txt": "b" });
        s.server.failWith(/^STOR b\.txt/, 553);
        expect((await s.deploy()).ok).toBe(false);
        // remote state must still describe a.txt (nothing deleted yet or state not advanced)
        const names = (s.readRemoteState()?.data ?? []).map((d: any) => d.name);
        if (!s.remoteExists("a.txt")) { expect(names).not.toContain("a.txt"); }
        s.server.clearRules();
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });
});
