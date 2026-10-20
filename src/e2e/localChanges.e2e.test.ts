/**
 * Client side state transitions: start from a fully synced server, change the LOCAL folder in every way we can think of,
 * deploy again and verify the server converged AND that only the minimum amount of work was done.
 */
import { Scenario } from "./harness/scenario";
import { TreeSpec } from "./harness/fsTree";

jest.setTimeout(30000);

const baseline: TreeSpec = {
    "index.html": "<h1>v1</h1>",
    "style.css": "body { color: red }",
    css: { "main.css": "main", "print.css": "print" },
    js: { app: { "app.js": "app", "util.js": "util" }, "vendor.js": "vendor" },
    emptyDir: {},
    docs: { guide: { "intro.md": "intro", deep: { "deeper.md": "deeper" } } },
};

describe("local changes after a synced deploy", () => {
    let s: Scenario;

    beforeEach(async () => {
        s = await Scenario.create();
        s.setLocal(baseline);
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
        s.server.resetCommandLog();
    });

    afterEach(async () => { await s.destroy(); });

    test("nothing changed => nothing uploaded, deleted or created", async () => {
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual([]);
        expect(run.deletes).toEqual([]);
        expect(run.removedDirs).toEqual([]);
        // ensureDir("./") sends a harmless MKD "." every run, anything else would be a real folder creation
        expect(run.madeDirs.filter(d => d !== ".")).toEqual([]);
        s.expectRemoteInSync();
    });

    test("the state file is rewritten on every successful deploy", async () => {
        const before = s.readRemoteState().generatedTime;
        await new Promise(r => setTimeout(r, 5));
        (await s.deploy()).expectOk();
        expect(s.readRemoteState().generatedTime).toBeGreaterThan(before);
    });

    test("new file at the root", async () => {
        s.patchLocal({ "new.txt": "new" });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["new.txt"]);
        expect(run.deletes).toEqual([]);
        s.expectRemoteInSync();
    });

    test("new file inside an existing folder", async () => {
        s.patchLocal({ css: { "extra.css": "extra" } });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["css/extra.css"]);
        s.expectRemoteInSync();
    });

    test("new file inside brand new nested folders", async () => {
        s.patchLocal({ a: { b: { c: { "file.txt": "deep" } } } });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["a/b/c/file.txt"]);
        s.expectRemoteInSync();
        expect(s.remoteExists("a/b/c")).toBe(true);
    });

    test("new empty folder", async () => {
        s.patchLocal({ brandNewEmpty: {} });
        (await s.deploy()).expectOk();

        s.expectRemoteInSync();
        expect(s.remoteExists("brandNewEmpty")).toBe(true);
    });

    test("modified file (same size, different content)", async () => {
        s.patchLocal({ "index.html": "<h1>v2</h1>" });
        expect(s.readRemoteFile("index.html")).toHaveLength("<h1>v2</h1>".length);

        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["index.html"]);
        expect(s.readRemoteFile("index.html")).toBe("<h1>v2</h1>");
        s.expectRemoteInSync();
    });

    test("modified file (bigger)", async () => {
        s.patchLocal({ "style.css": "body { color: red } /* plus a lot more */".repeat(100) });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["style.css"]);
        s.expectRemoteInSync();
    });

    test("modified file becomes empty", async () => {
        s.patchLocal({ "style.css": "" });
        (await s.deploy()).expectOk();

        expect(s.readRemoteFile("style.css")).toBe("");
        s.expectRemoteInSync();
    });

    test("only changed files are re-uploaded when many files exist", async () => {
        s.patchLocal({ css: { "main.css": "changed" }, js: { app: { "util.js": "changed" } } });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState().sort()).toEqual(["css/main.css", "js/app/util.js"]);
        s.expectRemoteInSync();
    });

    test("deleted file", async () => {
        s.removeLocal("style.css");
        const run = (await s.deploy()).expectOk();

        expect(run.deletes).toEqual(["style.css"]);
        expect(run.uploadsExcludingState()).toEqual([]);
        s.expectRemoteInSync();
    });

    test("deleted file in a nested folder keeps the folder", async () => {
        s.removeLocal("js/app/util.js");
        (await s.deploy()).expectOk();

        s.expectRemoteInSync();
        expect(s.remoteExists("js/app/app.js")).toBe(true);
    });

    test("deleted empty folder", async () => {
        s.removeLocal("emptyDir");
        const run = (await s.deploy()).expectOk();

        expect(run.removedDirs.length).toBe(1);
        expect(s.remoteExists("emptyDir")).toBe(false);
        s.expectRemoteInSync();
    });

    test("deleted folder with nested files and folders", async () => {
        s.removeLocal("docs");
        (await s.deploy()).expectOk();

        expect(s.remoteExists("docs")).toBe(false);
        s.expectRemoteInSync();
    });

    test("deleted everything", async () => {
        for (const name of Object.keys(baseline)) { s.removeLocal(name); }
        (await s.deploy()).expectOk();

        s.expectRemote({});
        // the previous run's local state file is still in the folder, so the state only ever lists itself
        expect(s.readRemoteState().data.map((d: any) => d.name)).toEqual([".ftp-deploy-sync-state.json"]);
    });

    test("renamed file = upload new + delete old", async () => {
        s.renameLocal("style.css", "styles.css");
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["styles.css"]);
        expect(run.deletes).toEqual(["style.css"]);
        s.expectRemoteInSync();
    });

    test("renamed folder", async () => {
        s.renameLocal("css", "styles");
        (await s.deploy()).expectOk();

        expect(s.remoteExists("css")).toBe(false);
        s.expectRemoteInSync();
    });

    test("file moved to another folder", async () => {
        s.renameLocal("css/print.css", "js/print.css");
        (await s.deploy()).expectOk();

        s.expectRemoteInSync();
    });

    test("folder moved inside another folder", async () => {
        s.renameLocal("js/app", "docs/app");
        (await s.deploy()).expectOk();

        s.expectRemoteInSync();
        expect(s.remoteExists("js/app")).toBe(false);
    });

    test("swap contents of two files", async () => {
        s.patchLocal({ css: { "main.css": "print", "print.css": "main" } });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState().sort()).toEqual(["css/main.css", "css/print.css"]);
        s.expectRemoteInSync();
    });

    test("duplicate content in different files is tracked per path", async () => {
        s.patchLocal({ "copy1.txt": "same", "copy2.txt": "same" });
        (await s.deploy()).expectOk();
        s.removeLocal("copy1.txt");
        const run = (await s.deploy()).expectOk();

        expect(run.deletes).toEqual(["copy1.txt"]);
        expect(s.readRemoteFile("copy2.txt")).toBe("same");
    });

    test("several kinds of change in one deploy", async () => {
        s.patchLocal({ "index.html": "changed", "added.txt": "added", css: { "new.css": "x" } });
        s.removeLocal("js");
        s.renameLocal("style.css", "style2.css");
        const run = (await s.deploy()).expectOk();

        s.expectRemoteInSync();
        expect(run.uploadsExcludingState().sort()).toEqual(["added.txt", "css/new.css", "index.html", "style2.css"]);
    });

    test("change, revert, change again (state always follows local)", async () => {
        for (const content of ["a", "b", "a", "c", "a"]) {
            s.patchLocal({ "index.html": content });
            (await s.deploy()).expectOk();
            expect(s.readRemoteFile("index.html")).toBe(content);
        }
    });

    test("state file saved on the server lists exactly the local files", async () => {
        s.patchLocal({ "added.txt": "added" });
        s.removeLocal("emptyDir");
        (await s.deploy()).expectOk();

        const names = s.readRemoteState().data.map((d: any) => d.name);
        const localNames = Object.keys(s.localTree());
        // the local state file is itself part of the local scan on the 2nd+ deploy
        expect(names.filter((n: string) => n !== ".ftp-deploy-sync-state.json").sort()).toEqual(localNames.sort());
    });
});

describe("local state file lifecycle", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test("deploying from a fresh checkout (no local state file) after earlier deploys works", async () => {
        s.setLocal({ "a.txt": "a", "b.txt": "b" });
        (await s.deploy()).expectOk();

        // simulate CI: brand new checkout, local state file is gone
        s.removeLocal(".ftp-deploy-sync-state.json");
        s.patchLocal({ "b.txt": "b2" });
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["b.txt"]);
        s.expectRemoteInSync();
        expect(s.remoteExists(".ftp-deploy-sync-state.json")).toBe(true);
    });

    test("the local state file is never uploaded as a regular file or deleted from the server by mistake", async () => {
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        (await s.deploy()).expectOk();
        s.removeLocal(".ftp-deploy-sync-state.json");
        (await s.deploy()).expectOk();

        expect(s.readRemoteState()).toBeDefined();
        expect(s.readRemoteState().version).toBe("1.0.0");
    });

    test("a custom state-name is used on the server and for ignoring", async () => {
        s.setLocal({ "a.txt": "a" });
        (await s.deploy({ "state-name": "my-state.json" })).expectOk();

        expect(s.remoteExists("my-state.json")).toBe(true);
        expect(s.remoteExists(".ftp-deploy-sync-state.json")).toBe(false);

        s.server.resetCommandLog();
        const run = (await s.deploy({ "state-name": "my-state.json" })).expectOk();
        expect(run.uploadsExcludingState("my-state.json")).toEqual([]);
    });

    test("no stray temp files are left in the working directory", async () => {
        const fs = await import("fs");
        s.setLocal({ "a.txt": "a" });
        (await s.deploy()).expectOk();
        (await s.deploy()).expectOk();

        expect(fs.readdirSync(s.cwdDir)).toEqual([]);
    });
});
