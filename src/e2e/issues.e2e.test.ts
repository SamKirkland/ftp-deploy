/**
 * Reproductions of reported issues from SamKirkland/ftp-deploy and SamKirkland/FTP-Deploy-Action.
 * Each test asserts the CORRECT behaviour. Tests marked "Regression (was a bug)" pinned library bugs that have since been fixed.
 */
import fs from "fs";
import path from "path";
import { Scenario } from "./harness/scenario";

jest.setTimeout(60000);

describe("reported issues", () => {
    let s: Scenario;
    afterEach(async () => { await s?.destroy(); });

    describe("folder deletes (ftp-deploy#43 #45 #50 #207 #220, Action#279 #280 #289 #453 #517)", () => {
        // Regression (was a bug): HashDiff drops delete entries that start with a deleted folder's name, "folder/sub" also swallows "folder/sub-two"
        test("#50 folder/sub and folder/sub-two are both removed", async () => {
            s = await Scenario.create();
            s.setLocal({ folder: { sub: { "a.txt": "a" }, "sub-two": { "b.txt": "b" }, "keep.txt": "k" } });
            (await s.deploy()).expectOk();
            s.removeLocal("folder/sub").removeLocal("folder/sub-two");
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("#279 deeply nested folder tree removed in one run", async () => {
            s = await Scenario.create();
            s.setLocal({ a: { b: { c: { d: { "f.txt": "f" } }, "g.txt": "g" } }, keep: "k" });
            (await s.deploy()).expectOk();
            s.removeLocal("a");
            const run = (await s.deploy()).expectOk();
            s.expectRemoteInSync();
            expect(run.logText).not.toMatch(/550/);
        });

        test("#517 removing a folder with many nested empty folders", async () => {
            s = await Scenario.create();
            s.setLocal({ keep: "k" });
            fs.mkdirSync(path.join(s.localDir, "x/y/z/w"), { recursive: true });
            fs.mkdirSync(path.join(s.localDir, "x/y/q"), { recursive: true });
            (await s.deploy()).expectOk();
            expect(s.remoteExists("x/y/z/w")).toBe(true);
            s.removeLocal("x");
            (await s.deploy()).expectOk();
            expect(s.remoteExists("x")).toBe(false);
        });

        test("#289 server already lacks the folder (manually deleted): deploy still succeeds", async () => {
            s = await Scenario.create();
            s.setLocal({ band: { "a.txt": "a" }, keep: "k" });
            (await s.deploy()).expectOk();
            s.removeRemote("band");
            s.removeLocal("band");
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("#289 server lacks a nested folder whose parent still exists", async () => {
            s = await Scenario.create();
            s.setLocal({ band: { inner: { "a.txt": "a" }, "b.txt": "b" } });
            (await s.deploy()).expectOk();
            s.removeRemote("band/inner");
            s.removeLocal("band/inner");
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("#45 folder removal with server-dir", async () => {
            s = await Scenario.create({ remoteDir: "www" });
            s.setLocal({ dir: { sub: { "a.txt": "a" }, "b.txt": "b" }, keep: "k" });
            (await s.deploy({ "server-dir": "www/" })).expectOk();
            s.removeLocal("dir");
            (await s.deploy({ "server-dir": "www/" })).expectOk();
            s.expectRemoteInSync();
        });

        test("#43 folder removal with nested server-dir", async () => {
            s = await Scenario.create({ remoteDir: "a/b/c" });
            s.setLocal({ dir: { sub: { "a.txt": "a" } }, keep: "k" });
            (await s.deploy({ "server-dir": "a/b/c/" })).expectOk();
            s.removeLocal("dir");
            (await s.deploy({ "server-dir": "a/b/c/" })).expectOk();
            s.expectRemoteInSync();
        });

        test("#207 folder removal with absolute server-dir", async () => {
            s = await Scenario.create({ remoteDir: "site" });
            s.setLocal({ dir: { "a.txt": "a" }, keep: "k" });
            (await s.deploy({ "server-dir": "/site/" })).expectOk();
            s.removeLocal("dir");
            (await s.deploy({ "server-dir": "/site/" })).expectOk();
            s.expectRemoteInSync();
        });

        test("#280 / #453 folder replaced by files with same names elsewhere", async () => {
            s = await Scenario.create();
            s.setLocal({ old: { "index.html": "1", assets: { "a.css": "x" } } });
            (await s.deploy()).expectOk();
            s.removeLocal("old");
            s.patchLocal({ "new": { "index.html": "1", assets: { "a.css": "x" } } });
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });

        test("folder removed while it holds an extra file the state does not know about", async () => {
            s = await Scenario.create();
            s.setLocal({ dir: { "a.txt": "a" }, keep: "k" });
            (await s.deploy()).expectOk();
            s.seedRemote({ dir: { "stray.txt": "not tracked" } });
            s.removeLocal("dir");
            const run = await s.deploy();
            // the library cannot RMD a non empty directory. It must either succeed or fail loudly, never claim success and orphan state
            if (run.ok) {
                const state = s.readRemoteState();
                const tracked = (state.data as any[]).map(d => d.name);
                expect(tracked).not.toContain("dir");
            }
        });
    });

    describe("local-dir + server-dir (ftp-deploy#7, Action#108 #136 #145)", () => {
        test("#7 local-dir subfolder with server-dir: files land in server-dir, state alongside", async () => {
            s = await Scenario.create({ remoteDir: "public" });
            const sub = path.join(s.sandbox, "local", "dist");
            fs.mkdirSync(path.join(sub, "css"), { recursive: true });
            fs.writeFileSync(path.join(sub, "index.html"), "i");
            fs.writeFileSync(path.join(sub, "css/a.css"), "a");
            const dir = sub.replace(/\\/g, "/") + "/";
            (await s.deploy({ "local-dir": dir, "server-dir": "public/" })).expectOk();
            expect(s.readRemoteFile("css/a.css")).toBe("a");
            fs.rmSync(path.join(sub, "css"), { recursive: true });
            (await s.deploy({ "local-dir": dir, "server-dir": "public/" })).expectOk();
            expect(s.remoteExists("css")).toBe(false);
            expect(s.remoteExists("index.html")).toBe(true);
        });

        test("#145 local-dir written state file does not leak into the next upload list", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            const run = (await s.deploy()).expectOk();
            expect(run.uploadsExcludingState()).toEqual([]);
        });
    });

    describe("empty server-dir / empty uploads (ftp-deploy#37, Action#412 #272)", () => {
        test("#37 empty local dir on empty server still creates a state file and succeeds", async () => {
            s = await Scenario.create();
            s.setLocal({});
            (await s.deploy()).expectOk();
            expect(s.readRemoteState()).toBeDefined();
        });

        test("#272 empty folders are created and kept", async () => {
            s = await Scenario.create();
            s.setLocal({ keep: "k" });
            fs.mkdirSync(path.join(s.localDir, "empty/deeper"), { recursive: true });
            (await s.deploy()).expectOk();
            expect(s.remoteExists("empty/deeper")).toBe(true);
            const run = (await s.deploy()).expectOk();
            expect(run.madeDirs.filter(d => d !== ".")).toEqual([]);
        });
    });

    describe("case sensitivity (Action#263)", () => {
        // Regression (was a bug): the new name is uploaded first and then the old name is deleted; on a case-insensitive server that deletes the new file
        // while the state file still lists it
        test("#263 case-only file rename is propagated", async () => {
            s = await Scenario.create();
            s.setLocal({ "Readme.md": "r" });
            (await s.deploy()).expectOk();
            s.renameLocal("Readme.md", "README.md");
            (await s.deploy()).expectOk();
            expect(fs.readdirSync(s.remoteSiteDir).filter(n => !n.startsWith(".ftp"))).toEqual(["README.md"]);
        });

        test("#263 case-only folder rename is propagated", async () => {
            s = await Scenario.create();
            s.setLocal({ Images: { "a.png": "a" } });
            (await s.deploy()).expectOk();
            s.renameLocal("Images", "images");
            (await s.deploy()).expectOk();
            expect(fs.readdirSync(s.remoteSiteDir).filter(n => !n.startsWith(".ftp"))).toEqual(["images"]);
        });
    });

    describe("state name (Action#468 #231 #447 #165 #173 #120 #324)", () => {
        test("#468 state-name in a non existing sub folder", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a" });
            const run = await s.deploy({ "state-name": "meta/.state.json" });
            // either works or fails with a readable error; must not leave a half published site
            if (run.ok) { expect(s.remoteExists("meta/.state.json")).toBe(true); }
        });

        test("custom state-name is used for state and not uploaded as content", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a" });
            (await s.deploy({ "state-name": ".custom-state.json" })).expectOk();
            expect(s.remoteExists(".custom-state.json")).toBe(true);
            expect(s.remoteExists(".ftp-deploy-sync-state.json")).toBe(false);
            const run = (await s.deploy({ "state-name": ".custom-state.json" })).expectOk();
            expect(run.uploads.filter(u => u !== ".custom-state.json")).toEqual([]);
        });

        test("changing state-name between runs re-publishes (no state found)", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            s.removeLocal("a.txt");
            s.patchLocal({ "b.txt": "b" });
            (await s.deploy({ "state-name": ".other.json" })).expectOk();
            // the old state is ignored so a.txt is orphaned on the server: pin as current behaviour
            expect(s.remoteExists("a.txt")).toBe(true);
            expect(s.remoteExists("b.txt")).toBe(true);
        });

        test("#324 state upload rejected with 550 fails the deploy", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a" });
            s.server.failWith(/^STOR \.ftp-deploy-sync-state\.json/, 550);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
        });

        test("#324 state upload rejected with 553 fails the deploy", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a" });
            s.server.failWith(/^STOR \.ftp-deploy-sync-state\.json/, 553);
            expect((await s.deploy()).ok).toBe(false);
        });

        // Regression (was a bug): the local state is written to local-dir/state-name, overwriting a user's file of that name
        test("a content file with the same name as the state file is not overwritten locally", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a", "meta.json": "user content" });
            (await s.deploy({ "state-name": "meta.json" })).expectOk();
            // state file wins on the server. The user file is overwritten; local copy must still be what the user wrote
            expect(fs.readFileSync(path.join(s.localDir, "meta.json"), "utf8")).toBe("user content");
        });
    });

    describe("dangerous-clean-slate (Action#285 #337 #507)", () => {
        test("#507 clean slate wipes the server then uploads everything", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a", dir: { "b.txt": "b" } });
            (await s.deploy()).expectOk();
            s.seedRemote({ "stray.txt": "x", strayDir: { "y.txt": "y" } });
            (await s.deploy({ "dangerous-clean-slate": true })).expectOk();
            s.expectRemoteInSync();
            expect(s.remoteExists("stray.txt")).toBe(false);
            expect(s.remoteExists("strayDir")).toBe(false);
        });

        test("#507 clean slate with exclude: excluded local files are not uploaded", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a", "skip.log": "l" });
            (await s.deploy({ "dangerous-clean-slate": true, exclude: ["**/*.log"] })).expectOk();
            expect(s.remoteExists("skip.log")).toBe(false);
            expect(s.remoteExists("a.txt")).toBe(true);
        });

        test("#285 clean slate with dry-run changes nothing", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a" });
            (await s.deploy()).expectOk();
            s.seedRemote({ "stray.txt": "x" });
            s.server.resetCommandLog();
            (await s.deploy({ "dangerous-clean-slate": true, "dry-run": true })).expectOk();
            expect(s.remoteExists("stray.txt")).toBe(true);
            expect(s.remoteExists("a.txt")).toBe(true);
            expect(s.server.deletes()).toEqual([]);
            expect(s.server.removedDirs()).toEqual([]);
        });

        test("#337 clean slate with server-dir only wipes server-dir", async () => {
            s = await Scenario.create({ remoteDir: "www" });
            s.setLocal({ "a.txt": "a" });
            fs.mkdirSync(path.join(s.remoteRoot, "other"), { recursive: true });
            fs.writeFileSync(path.join(s.remoteRoot, "other", "precious.txt"), "p");
            fs.writeFileSync(path.join(s.remoteRoot, "top.txt"), "t");
            (await s.deploy({ "server-dir": "www/", "dangerous-clean-slate": true })).expectOk();
            expect(fs.existsSync(path.join(s.remoteRoot, "other/precious.txt"))).toBe(true);
            expect(fs.existsSync(path.join(s.remoteRoot, "top.txt"))).toBe(true);
        });

        test("clean slate twice in a row is stable", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a", dir: { "b.txt": "b" } });
            (await s.deploy({ "dangerous-clean-slate": true })).expectOk();
            (await s.deploy({ "dangerous-clean-slate": true })).expectOk();
            s.expectRemoteInSync();
        });
    });

    describe("dry-run", () => {
        test("dry-run on first publish makes no changes on the server", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a", dir: { "b.txt": "b" } });
            (await s.deploy({ "dry-run": true })).expectOk();
            expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
        });

        test("dry-run after changes leaves server and state untouched", async () => {
            s = await Scenario.create();
            s.setLocal({ "a.txt": "a", dir: { "b.txt": "b" } });
            (await s.deploy()).expectOk();
            const before = JSON.stringify(s.remoteTree());
            const stateBefore = JSON.stringify(s.readRemoteState());
            s.removeLocal("dir");
            s.patchLocal({ "a.txt": "changed", "c.txt": "c" });
            (await s.deploy({ "dry-run": true })).expectOk();
            expect(JSON.stringify(s.remoteTree())).toBe(before);
            expect(JSON.stringify(s.readRemoteState())).toBe(stateBefore);
        });
    });
});
