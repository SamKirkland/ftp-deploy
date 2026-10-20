/**
 * Server side state transitions: the remote is not what the library expects (no state, corrupt state, files changed
 * behind its back, ...). Verifies recovery and documents current behaviour. `test.failing` marks known library bugs:
 * they pass while the bug exists and will start failing (prompting removal of `.failing`) once it is fixed.
 */
import { Scenario } from "./harness/scenario";

jest.setTimeout(30000);

describe("server state variants", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test("empty server = first publish uploads everything", async () => {
        s.setLocal({ "a.txt": "a", dir: { "b.txt": "b" }, empty: {} });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState().sort()).toEqual(["a.txt", "dir/b.txt"]);
        expect(run.logText).toMatch(/first publish/i);
        s.expectRemoteInSync();
    });

    test("files exist on the server but there is no state file => everything is (re)uploaded, nothing is deleted", async () => {
        s.seedRemote({ "a.txt": "old", "unrelated.txt": "keep me" });
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();

        expect(s.readRemoteFile("a.txt")).toBe("a");
        expect(s.readRemoteFile("unrelated.txt")).toBe("keep me");
    });

    test("files not tracked by the state file are left alone", async () => {
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        s.seedRemote({ "uploads-from-cms.jpg": "img" });
        s.patchLocal({ "a.txt": "a2" });
        (await s.deploy()).expectOk();

        expect(s.readRemoteFile("uploads-from-cms.jpg")).toBe("img");
    });

    test("clean-slate wipes untracked server files then uploads", async () => {
        s.seedRemote({ "stale.txt": "stale", staleDir: { "x.txt": "x" } });
        s.setLocal({ "a.txt": "a" });
        (await s.deploy({ "dangerous-clean-slate": true })).expectOk();

        s.expectRemote({ "a.txt": "a" });
    });

    describe("a file was deleted on the server behind our back", () => {
        beforeEach(async () => {
            s.setLocal({ "a.txt": "a", "b.txt": "b", dir: { "c.txt": "c" } });
            (await s.deploy()).expectOk();
        });

        // characterization: the state file says it is there, so it is considered synced.
        test("is NOT restored while local is unchanged (state file is trusted)", async () => {
            s.removeRemote("a.txt");
            (await s.deploy()).expectOk();
            expect(s.remoteExists("a.txt")).toBe(false);
        });

        test("is restored once the local file changes", async () => {
            s.removeRemote("a.txt");
            s.patchLocal({ "a.txt": "a2" });
            (await s.deploy()).expectOk();
            expect(s.readRemoteFile("a.txt")).toBe("a2");
        });

        test("deleting locally a file that is already gone from the server is fine (550 swallowed)", async () => {
            s.removeRemote("a.txt");
            s.removeLocal("a.txt");
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("deleting locally a folder that is already gone from the server is fine", async () => {
            s.removeRemote("dir");
            s.removeLocal("dir");
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("whole site folder wiped but state file survives", async () => {
            s.removeRemote("a.txt").removeRemote("b.txt").removeRemote("dir");
            s.patchLocal({ "a.txt": "a2" });
            (await s.deploy()).expectOk();
            expect(s.readRemoteFile("a.txt")).toBe("a2");
        });
    });

    describe("a file was modified on the server behind our back", () => {
        test("is not noticed while local is unchanged (characterization)", async () => {
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            s.seedRemote({ "a.txt": "tampered" });
            const run = (await s.deploy()).expectOk();

            expect(run.uploadsExcludingState()).toEqual([]);
            expect(s.readRemoteFile("a.txt")).toBe("tampered");
        });

        test("is overwritten once local changes", async () => {
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            s.seedRemote({ "a.txt": "tampered" });
            s.patchLocal({ "a.txt": "a2" });
            (await s.deploy()).expectOk();
            expect(s.readRemoteFile("a.txt")).toBe("a2");
        });
    });

    describe("unusable state file on the server", () => {
        const cases: Array<[string, string]> = [
            ["empty", ""],
            ["not json", "this is not json"],
            ["truncated json", '{"description":"x","version":"1.0.0","generatedTime":1,"data":[{"type":"file","name":"a.tx'],
            ["json null", "null"],
            ["json array", "[]"],
            ["json string", '"hello"'],
        ];

        test.each(cases)("%s => treated as first publish, everything re-uploaded, state repaired", async (_name, content) => {
            s.setLocal({ "a.txt": "a", dir: { "b.txt": "b" } });
            s.seedRemote({ "a.txt": "a", dir: { "b.txt": "b" } });
            s.writeRemoteState(content);

            const run = (await s.deploy()).expectOk();

            expect(run.uploadsExcludingState().sort()).toEqual(["a.txt", "dir/b.txt"]);
            s.expectRemoteInSync();
            expect(() => s.readRemoteState()).not.toThrow();
            expect(s.readRemoteState().version).toBe("1.0.0");
        });

        test("state with empty data list => everything re-uploaded", async () => {
            s.setLocal({ "a.txt": "a" });
            s.writeRemoteState({ description: "", version: "1.0.0", generatedTime: 1, data: [] });
            const run = (await s.deploy()).expectOk();
            expect(run.uploadsExcludingState()).toEqual(["a.txt"]);
        });

        test("state listing files that never existed on the server => they are deleted (550 swallowed)", async () => {
            s.setLocal({ "a.txt": "a" });
            s.writeRemoteState({
                description: "", version: "1.0.0", generatedTime: 1,
                data: [{ type: "file", name: "ghost.txt", size: 1, hash: "x" }, { type: "folder", name: "ghostDir" }],
            });
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("state hash matches but file is missing => trusted (characterization)", async () => {
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            const state = s.readRemoteState();
            s.removeRemote("a.txt");
            s.writeRemoteState(state);
            const run = (await s.deploy()).expectOk();
            expect(run.uploadsExcludingState()).toEqual([]);
        });
    });

    describe("orphans", () => {
        test("files inside a folder deleted locally are removed even when not in the state (folder removal is recursive)", async () => {
            s.setLocal({ keep: { "k.txt": "k" }, gone: { "g.txt": "g" } });
            (await s.deploy()).expectOk();
            s.seedRemote({ gone: { "orphan.txt": "o" } });
            s.removeLocal("gone");
            (await s.deploy()).expectOk();

            expect(s.remoteExists("gone")).toBe(false);
        });
    });
});

describe("dry run", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    const WRITES = ["STOR", "DELE", "MKD", "XMKD", "RMD", "XRMD"];

    test("changes nothing on the server, not even the state file", async () => {
        s.setLocal({ "a.txt": "a", dir: { "b.txt": "b" } });
        const run = (await s.deploy({ "dry-run": true })).expectOk();

        s.expectRemote({});
        expect(s.readRemoteState()).toBeUndefined();
        expect(run.commands.filter(c => WRITES.includes(c.directive) && c.arg !== ".")).toEqual([]);
    });

    test("does not modify an existing deployment", async () => {
        s.setLocal({ "a.txt": "a", "b.txt": "b" });
        (await s.deploy()).expectOk();
        const stateBefore = s.readRemoteState();

        s.patchLocal({ "a.txt": "a2" });
        s.removeLocal("b.txt");
        s.server.resetCommandLog();
        const run = (await s.deploy({ "dry-run": true })).expectOk();

        expect(s.readRemoteFile("a.txt")).toBe("a");
        expect(s.remoteExists("b.txt")).toBe(true);
        expect(s.readRemoteState()).toEqual(stateBefore);
        expect(run.commands.filter(c => WRITES.includes(c.directive) && c.arg !== ".")).toEqual([]);
    });
});

describe("exclude", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test("default excludes keep .git and node_modules off the server", async () => {
        s.setLocal({
            "a.txt": "a",
            ".git": { HEAD: "ref" },
            node_modules: { pkg: { "index.js": "x" } },
            src: { ".git": { x: "x" }, "ok.js": "ok" },
        });
        (await s.deploy()).expectOk();

        s.expectRemote({ "a.txt": "a", src: { "ok.js": "ok" } });
    });

    test("custom exclude globs", async () => {
        s.setLocal({ "a.txt": "a", "b.log": "b", logs: { "x.log": "x", "y.txt": "y" } });
        (await s.deploy({ exclude: ["**/*.log"] })).expectOk();

        s.expectRemote({ "a.txt": "a", logs: { "y.txt": "y" } });
    });

    test("a file that becomes excluded later is left on the server (server state is filtered by the same excludes, characterization)", async () => {
        s.setLocal({ "a.txt": "a", "b.log": "b" });
        (await s.deploy({ exclude: [] })).expectOk();
        expect(s.remoteExists("b.log")).toBe(true);

        const run = (await s.deploy({ exclude: ["**/*.log"] })).expectOk();
        expect(run.deletes).toEqual([]);
        expect(s.remoteExists("b.log")).toBe(true);
    });
});
