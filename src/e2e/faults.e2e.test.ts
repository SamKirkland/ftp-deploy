/**
 * Failure injection: transient errors, dropped connections, interrupted transfers.
 * Invariants we care about:
 *   1. a failed deploy never advances the remote state file past what really got uploaded
 *   2. a healthy redeploy after any failure converges to the local tree
 */
import fs from "fs";
import path from "path";
import { Scenario } from "./harness/scenario";

jest.setTimeout(60000);

describe("fault injection", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    describe("transient 4xx errors (retried once)", () => {
        test("one 450 on STOR is retried and the deploy succeeds", async () => {
            s.server.failWith("STOR", 450, { times: 1 });
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("two 450s in a row on STOR fail the deploy", async () => {
            s.server.failWith("STOR", 450, { times: 2 });
            s.setLocal({ "a.txt": "a" });
            expect((await s.deploy()).ok).toBe(false);
        });

        test("a failed first deploy writes no state file", async () => {
            s.server.failWith(/^STOR a\.txt/, 450);
            s.setLocal({ "a.txt": "a", "b.txt": "b" });
            expect((await s.deploy()).ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();
        });

        test("421 (service not available) fails the deploy", async () => {
            s.server.failWith("STOR", 421);
            s.setLocal({ "a.txt": "a" });
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();
        });

        // BUG: basic-ftp's ensureDir ignores the MKD error and the following CWD fails with 550, which retryRequest does not retry
        test.failing("transient 450 on MKD is retried", async () => {
            s.server.failWith("MKD", 450, { times: 1, skip: 1 });
            s.setLocal({ dir: { "a.txt": "a" } });
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });

    describe("delete failures", () => {
        beforeEach(async () => {
            s.setLocal({ "a.txt": "a", "b.txt": "b", dir: { "c.txt": "c" } });
            (await s.deploy()).expectOk();
            s.server.resetCommandLog();
        });

        test("550 on DELE is skipped and the deploy continues", async () => {
            s.server.failWith("DELE", 550);
            s.removeLocal("a.txt");
            const run = (await s.deploy()).expectOk();
            expect(run.logText).toMatch(/skipping/i);
        });

        test("550 on RMD is skipped and the deploy continues", async () => {
            s.server.failWith("RMD", 550);
            s.removeLocal("dir");
            (await s.deploy()).expectOk();
        });

        // BUG: a permission-denied delete is indistinguishable from "already gone", state is updated and the file is orphaned forever
        test.failing("a delete that failed with 550 must not be forgotten (file is still there)", async () => {
            s.server.failWith("DELE", 550);
            s.removeLocal("a.txt");
            (await s.deploy()).expectOk();
            s.server.clearRules();

            (await s.deploy()).expectOk();
            expect(s.remoteExists("a.txt")).toBe(false);
        });

        test("550 on DELE of a file that really was missing is fine", async () => {
            s.removeRemote("a.txt");
            s.removeLocal("a.txt");
            (await s.deploy()).expectOk();
        });
    });

    describe("connection loss", () => {
        test("connection dropped before login fails", async () => {
            s.server.addRule({ match: "USER", action: { type: "drop" } });
            s.setLocal({ "a.txt": "a" });
            expect((await s.deploy()).ok).toBe(false);
            s.expectRemote({});
        });

        test("connection dropped while uploading leaves no state and a healthy rerun converges", async () => {
            s.setLocal({ "a.txt": "a", "b.txt": "b", "c.txt": "c" });
            s.server.addRule({ match: /^STOR b\.txt/, action: { type: "drop" } });

            expect((await s.deploy()).ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();

            s.server.clearRules();
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("connection dropped mid file transfer leaves a partial file; rerun repairs it", async () => {
            const big = "0123456789".repeat(50000); // 500kB
            s.setLocal({ "big.txt": big, "small.txt": "s" });
            s.server.addRule({ match: /^STOR big\.txt/, action: { type: "dropDuringUpload", afterBytes: 100000 } });

            expect((await s.deploy()).ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();

            s.server.clearRules();
            (await s.deploy()).expectOk();
            expect(s.readRemoteFile("big.txt")).toBe(big);
            s.expectRemoteInSync();
        });

        test("dropped while replacing a modified file: previous state is kept and rerun repairs", async () => {
            const v1 = "A".repeat(300000);
            const v2 = "B".repeat(300000);
            s.setLocal({ "big.txt": v1, "other.txt": "o" });
            (await s.deploy()).expectOk();
            const stateBefore = s.readRemoteState();

            s.patchLocal({ "big.txt": v2 });
            s.server.addRule({ match: /^STOR big\.txt/, action: { type: "dropDuringUpload", afterBytes: 50000 } });
            expect((await s.deploy()).ok).toBe(false);
            expect(s.readRemoteState()).toEqual(stateBefore);

            s.server.clearRules();
            (await s.deploy()).expectOk();
            expect(s.readRemoteFile("big.txt")).toBe(v2);
        });

        // BUG: after a partial replace, reverting the local file to the previous content looks "unchanged" to the diff,
        // so the corrupted remote file is never repaired.
        test.failing("partial replace followed by reverting local to the old content still repairs the server", async () => {
            const v1 = "A".repeat(300000);
            s.setLocal({ "big.txt": v1 });
            (await s.deploy()).expectOk();

            s.patchLocal({ "big.txt": "B".repeat(300000) });
            s.server.addRule({ match: /^STOR big\.txt/, action: { type: "dropDuringUpload", afterBytes: 50000 } });
            expect((await s.deploy()).ok).toBe(false);
            s.server.clearRules();

            s.patchLocal({ "big.txt": v1 });
            (await s.deploy()).expectOk();
            expect(s.readRemoteFile("big.txt")).toBe(v1);
        });

        test("connection lost while saving the state file: rerun converges", async () => {
            s.setLocal({ "a.txt": "a" });
            s.server.addRule({ match: /^STOR \.ftp-deploy-sync-state\.json/, action: { type: "dropDuringUpload", afterBytes: 20 } });
            expect((await s.deploy()).ok).toBe(false);

            s.server.clearRules();
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
            expect(() => s.readRemoteState()).not.toThrow();
        });

        test("connection lost while deleting: rerun finishes the deletes", async () => {
            s.setLocal({ "a.txt": "a", "b.txt": "b", "c.txt": "c" });
            (await s.deploy()).expectOk();

            s.removeLocal("a.txt").removeLocal("b.txt").removeLocal("c.txt");
            s.server.addRule({ match: /^DELE b\.txt/, action: { type: "drop" } });
            expect((await s.deploy()).ok).toBe(false);

            s.server.clearRules();
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });

    describe("state download problems", () => {
        // BUG: any error fetching the state file is treated as "first publish": deleted files are orphaned, everything is re-uploaded
        test.failing("a failing RETR of the state file must not be silently treated as a first publish", async () => {
            s.setLocal({ "a.txt": "a", "b.txt": "b" });
            (await s.deploy()).expectOk();
            s.server.resetCommandLog();

            s.server.addRule({ match: /^RETR \.ftp-deploy-sync-state\.json/, action: { type: "reply", code: 550 } });
            s.removeLocal("b.txt");
            const run = await s.deploy();

            // either fail loudly or still delete b.txt, but never succeed while leaving the orphan
            if (run.ok) { expect(s.remoteExists("b.txt")).toBe(false); }
        });

        test("no temp files are left in the cwd after a failed state download", async () => {
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            s.server.addRule({ match: "RETR", action: { type: "reply", code: 550 } });
            await s.deploy();

            expect(fs.readdirSync(s.cwdDir)).toEqual([]);
        });
    });

    describe("slow server", () => {
        test("slow STOR still completes within the timeout", async () => {
            s.server.addRule({ match: "STOR", action: { type: "delay", ms: 300 } });
            s.setLocal({ "a.txt": "a" });
            (await s.deploy({ timeout: 5000 })).expectOk();
            s.expectRemoteInSync();
        });

        test("hanging STOR hits the timeout and fails", async () => {
            s.server.addRule({ match: /^STOR a\.txt/, action: { type: "hang" } });
            s.setLocal({ "a.txt": "a" });
            const run = await s.deploy({ timeout: 700 });
            expect(run.ok).toBe(false);
        });
    });
});

/**
 * Whatever single command we kill, a healthy rerun must reach the correct end state.
 * Runs a "complex change" deploy once to count the commands, then once per command index with the connection dropped there.
 */
describe("kill at every command", () => {
    const baseline = { "keep.txt": "k", "mod.txt": "v1", gone: { "g.txt": "g" }, nested: { deep: { "d.txt": "d" } } };
    const target = { "keep.txt": "k", "mod.txt": "v2", added: { "n.txt": "n" }, nested: { deep: { "d.txt": "d", "e.txt": "e" } } };

    async function prepare() {
        const sc = await Scenario.create();
        sc.setLocal(baseline);
        (await sc.deploy()).expectOk();
        sc.setLocal(target);
        sc.removeLocal(".ftp-deploy-sync-state.json");
        sc.server.resetCommandLog();
        return sc;
    }

    test("every interruption point converges after a healthy rerun", async () => {
        const probe = await prepare();
        (await probe.deploy()).expectOk();
        const total = probe.server.commands.length;
        await probe.destroy();
        expect(total).toBeGreaterThan(10);

        const failures: string[] = [];
        for (let skip = 0; skip < total; skip++) {
            const sc = await prepare();
            try {
                // drop the connection at the n-th command of the deploy phase (commands before are login etc.)
                sc.server.addRule({ match: /.*/, action: { type: "drop" }, skip, times: 1 });
                await sc.deploy({ timeout: 3000 });
                sc.server.clearRules();

                const rerun = await sc.deploy({ timeout: 3000 });
                if (!rerun.ok) { failures.push(`kill at ${skip}: rerun failed: ${rerun.error}`); continue; }

                const problems: string[] = [];
                const actual = JSON.stringify(sc.remoteTree());
                const expected = JSON.stringify(sc.expectedRemoteFromLocal());
                if (actual !== expected) { problems.push(`remote ${actual} != expected ${expected}`); }
                if (problems.length) { failures.push(`kill at ${skip}: ${problems.join("; ")}`); }
            }
            finally {
                await sc.destroy();
            }
        }

        expect(failures).toEqual([]);
    });
});
