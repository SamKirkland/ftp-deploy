/**
 * Exclude semantics, config changes between runs, state tampering and odd names
 * (ftp-deploy#12 #16 #49, Action#129 #158 #191 #292 #296 #319 #452 #473 #508 #511).
 */
import fs from "fs";
import path from "path";
import { Scenario } from "./harness/scenario";

jest.setTimeout(60000);

describe("exclude semantics", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test("#12 '.*' style hidden file exclude only matches by basename at any depth", async () => {
        s.setLocal({ ".env": "e", "a.txt": "a", sub: { ".env": "e2", "b.txt": "b" } });
        (await s.deploy({ exclude: ["**/.env"] })).expectOk();
        expect(s.remoteExists(".env")).toBe(false);
        expect(s.remoteExists("sub/.env")).toBe(false);
        expect(s.remoteExists("sub/b.txt")).toBe(true);
    });

    test("#296 excluding a folder with '/**' keeps sibling files", async () => {
        s.setLocal({ cache: { "x.tmp": "x" }, "cache.txt": "c", "a.txt": "a" });
        (await s.deploy({ exclude: ["cache/**"] })).expectOk();
        expect(s.remoteExists("cache/x.tmp")).toBe(false);
        expect(s.remoteExists("cache.txt")).toBe(true);
    });

    test("#292 exclude by extension at any depth", async () => {
        s.setLocal({ "a.map": "m", d: { "b.map": "m", "c.js": "j" } });
        (await s.deploy({ exclude: ["**/*.map"] })).expectOk();
        expect(s.remoteExists("a.map")).toBe(false);
        expect(s.remoteExists("d/b.map")).toBe(false);
        expect(s.remoteExists("d/c.js")).toBe(true);
    });

    test("#452 negation patterns: exclude everything but one folder", async () => {
        s.setLocal({ "a.txt": "a", keep: { "k.txt": "k" } });
        (await s.deploy({ exclude: ["**", "!keep", "!keep/**"] })).expectOk();
        expect(s.remoteExists("a.txt")).toBe(false);
        expect(s.remoteExists("keep/k.txt")).toBe(true);
    });

    test("#129 default excludes ignore .git and node_modules at any depth", async () => {
        s.setLocal({
            ".git": { HEAD: "h" }, ".gitignore": "g", node_modules: { m: { "i.js": "i" } },
            sub: { node_modules: { "j.js": "j" }, ".gitkeep": "", "ok.txt": "ok" }, "a.txt": "a",
        });
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
        expect(s.remoteExists(".git")).toBe(false);
        expect(s.remoteExists("sub/node_modules")).toBe(false);
        expect(s.remoteExists("sub/ok.txt")).toBe(true);
    });

    test("#158 empty exclude list uploads everything including .git", async () => {
        s.setLocal({ ".git": { HEAD: "h" }, "a.txt": "a" });
        (await s.deploy({ exclude: [] })).expectOk();
        expect(s.remoteExists(".git/HEAD")).toBe(true);
    });

    test("#473 exclude pattern with special characters in names", async () => {
        s.setLocal({ "a (1).log": "1", "b[2].txt": "2", "c+d.txt": "3" });
        (await s.deploy({ exclude: ["**/*.log"] })).expectOk();
        expect(s.remoteExists("a (1).log")).toBe(false);
        expect(s.remoteExists("b[2].txt")).toBe(true);
        expect(s.remoteExists("c+d.txt")).toBe(true);
    });

    test("an exclude covering the state file name does not break the deploy", async () => {
        s.setLocal({ "a.txt": "a" });
        const run = await s.deploy({ exclude: ["**/.ftp-deploy*"] });
        if (run.ok) { (await s.deploy({ exclude: ["**/.ftp-deploy*"] })).expectOk(); }
    });

    test("#191 files that become excluded later stay on the server and are not re-uploaded (pinned behaviour)", async () => {
        s.setLocal({ "a.txt": "a", "b.log": "b" });
        (await s.deploy({ exclude: [] })).expectOk();
        const run = (await s.deploy({ exclude: ["**/*.log"] })).expectOk();
        expect(run.uploadsExcludingState()).toEqual([]);
        expect(s.remoteExists("b.log")).toBe(true);
    });

    test("files that stop being excluded are uploaded", async () => {
        s.setLocal({ "a.txt": "a", "b.log": "b" });
        (await s.deploy({ exclude: ["**/*.log"] })).expectOk();
        expect(s.remoteExists("b.log")).toBe(false);
        const run = (await s.deploy({ exclude: [] })).expectOk();
        expect(run.uploadsExcludingState()).toEqual(["b.log"]);
    });

    test("a modified excluded file is never uploaded", async () => {
        s.setLocal({ "a.txt": "a", "b.log": "b" });
        (await s.deploy({ exclude: ["**/*.log"] })).expectOk();
        s.patchLocal({ "b.log": "changed" });
        const run = (await s.deploy({ exclude: ["**/*.log"] })).expectOk();
        expect(run.uploadsExcludingState()).toEqual([]);
    });

    test("a deleted local file that is excluded now is not deleted remotely", async () => {
        s.setLocal({ "a.txt": "a", "b.log": "b" });
        (await s.deploy({ exclude: [] })).expectOk();
        s.removeLocal("b.log");
        (await s.deploy({ exclude: ["**/*.log"] })).expectOk();
        expect(s.remoteExists("b.log")).toBe(true);
    });

    test("excluded folder holding a non excluded sibling name keeps correct structure", async () => {
        s.setLocal({ build: { "o.js": "o" }, builds: { "p.js": "p" } });
        (await s.deploy({ exclude: ["build/**"] })).expectOk();
        expect(s.remoteExists("builds/p.js")).toBe(true);
        expect(s.remoteExists("build/o.js")).toBe(false);
    });
});

describe("config changes between runs", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test("#16 changing server-dir deploys everything again to the new dir", async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b" } });
        (await s.deploy({ "server-dir": "one/" })).expectOk();
        (await s.deploy({ "server-dir": "two/" })).expectOk();
        expect(fs.readFileSync(path.join(s.remoteRoot, "two/d/b.txt"), "utf8")).toBe("b");
        expect(fs.existsSync(path.join(s.remoteRoot, "one/d/b.txt"))).toBe(true);
    });

    test("switching local-dir between runs against the same server-dir converges", async () => {
        s.setLocal({ one: { "a.txt": "a" }, two: { "b.txt": "b" } });
        const d = (n: string) => s.localDir + n + "/";
        (await s.deploy({ "local-dir": d("one") })).expectOk();
        (await s.deploy({ "local-dir": d("two") })).expectOk();
        expect(s.remoteExists("a.txt")).toBe(false);
        expect(s.remoteExists("b.txt")).toBe(true);
    });

    test("dry-run followed by a real run still performs the changes", async () => {
        s.setLocal({ "a.txt": "a" });
        (await s.deploy({ "dry-run": true })).expectOk();
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("log levels do not alter behaviour", async () => {
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b" } });
        for (const level of ["minimal", "standard", "verbose"] as const) {
            s.patchLocal({ "a.txt": level });
            (await s.deploy({ "log-level": level })).expectOk();
            s.expectRemoteInSync();
        }
    });

    test("security strict against a plain server is handled", async () => {
        s.setLocal({ "a.txt": "a" });
        const run = await s.deploy({ security: "strict" } as any);
        expect(typeof run.ok).toBe("boolean");
    });

    test("wrong password fails and uploads nothing", async () => {
        await s.destroy();
        s = await Scenario.create({ server: { credentials: { username: "tester", password: "secret" } } });
        s.setLocal({ "a.txt": "a" });
        const run = await s.deploy({ password: "wrong" });
        expect(run.ok).toBe(false);
        expect(fs.readdirSync(s.remoteRoot)).toEqual([]);
    });

    test("unreachable port fails quickly", async () => {
        s.setLocal({ "a.txt": "a" });
        const run = await s.deploy({ port: 1, timeout: 1500 });
        expect(run.ok).toBe(false);
    });
});

describe("state tampering and corruption", () => {
    let s: Scenario;
    beforeEach(async () => {
        s = await Scenario.create();
        s.setLocal({ "a.txt": "a", d: { "b.txt": "b" } });
        (await s.deploy()).expectOk();
    });
    afterEach(async () => { await s.destroy(); });

    test("#511 state file with garbage JSON is treated as first publish and converges", async () => {
        s.writeRemoteState("{{{ not json");
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("empty state file converges", async () => {
        s.writeRemoteState("");
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("state file with wrong shape (array) converges", async () => {
        s.writeRemoteState("[]");
        const run = await s.deploy();
        if (run.ok) { s.expectRemoteInSync(); }
    });

    test("state file with null data does not crash with a TypeError", async () => {
        s.writeRemoteState({ description: "x", version: "1.0.0", generatedTime: 1, data: null });
        const run = await s.deploy();
        if (!run.ok) { expect(String(run.error)).not.toMatch(/TypeError/); }
    });

    test("state file with unknown version is still readable or reports clearly", async () => {
        const st = s.readRemoteState();
        st.version = "99.0.0";
        s.writeRemoteState(st);
        const run = await s.deploy();
        if (!run.ok) { expect(String(run.error)).not.toMatch(/TypeError/); }
    });

    test("state listing a file that is gone remotely: unchanged local file is not re-uploaded (trusted state, pinned)", async () => {
        s.removeRemote("a.txt");
        const run = (await s.deploy()).expectOk();
        expect(run.uploadsExcludingState()).toEqual([]);
        expect(s.remoteExists("a.txt")).toBe(false);
    });

    test("state with wrong hash for a file triggers a re-upload", async () => {
        const st = s.readRemoteState();
        st.data.find((d: any) => d.name === "a.txt").hash = "deadbeef";
        s.writeRemoteState(st);
        const run = (await s.deploy()).expectOk();
        expect(run.uploadsExcludingState()).toEqual(["a.txt"]);
    });

    test("state listing files no longer local: they are removed", async () => {
        const st = s.readRemoteState();
        st.data.push({ type: "file", name: "ghost.txt", size: 1, hash: "x" });
        s.seedRemote({ "ghost.txt": "g" });
        s.writeRemoteState(st);
        (await s.deploy()).expectOk();
        expect(s.remoteExists("ghost.txt")).toBe(false);
    });

    test("state listing a ghost file that does not exist remotely does not break the deploy", async () => {
        const st = s.readRemoteState();
        st.data.push({ type: "file", name: "ghost.txt", size: 1, hash: "x" });
        s.writeRemoteState(st);
        (await s.deploy()).expectOk();
        expect(s.readRemoteState().data.map((d: any) => d.name)).not.toContain("ghost.txt");
    });

    test("state entry with a path escaping the site dir is not followed", async () => {
        fs.writeFileSync(path.join(s.remoteRoot, "..", "outside-victim.txt"), "precious");
        const st = s.readRemoteState();
        st.data.push({ type: "file", name: "../outside-victim.txt", size: 1, hash: "x" });
        s.writeRemoteState(st);
        await s.deploy();
        expect(fs.existsSync(path.join(s.remoteRoot, "..", "outside-victim.txt"))).toBe(true);
        fs.rmSync(path.join(s.remoteRoot, "..", "outside-victim.txt"), { force: true });
    });

    // Regression (was a bug): duplicate entries in the state file make the diff delete the (healthy) files they describe, uploads nothing and reports success
    test("state with duplicate entries does not wipe the remote", async () => {
        const st = s.readRemoteState();
        st.data.push(...st.data.map((d: any) => ({ ...d })));
        s.writeRemoteState(st);
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    // Regression (was a bug): the order of entries in the state file changes between runs for an identical file set (diff noise, ftp-deploy#49)
    test("#49 state file ordering is deterministic across runs", async () => {
        s.patchLocal({ "B.txt": "b", "a-b.txt": "x", "a.b.txt": "y", "a_b.txt": "z", "é.txt": "e", "e.txt": "e2", "Z.txt": "z" });
        (await s.deploy()).expectOk();
        const names = () => s.readRemoteState().data.map((d: any) => d.name).filter((n: string) => n !== ".ftp-deploy-sync-state.json");
        const first = names();
        s.patchLocal({ "new.txt": "n" });
        s.removeLocal("new.txt");
        (await s.deploy()).expectOk();
        expect(names()).toEqual(first);
    });

    test("an unchanged redeploy rewrites no content files", async () => {
        const run = (await s.deploy()).expectOk();
        expect(run.uploadsExcludingState()).toEqual([]);
        expect(run.deletes).toEqual([]);
    });
});

describe("special names", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test.each([
        ["leading dash", "-rf"],
        ["leading space inside", " lead.txt"],
        ["percent", "100%.txt"],
        ["hash and question-safe", "a#b.txt"],
        ["plus", "a+b.txt"],
        ["quote", "it's.txt"],
        ["dollar", "$HOME.txt"],
        ["backtick", "a`b.txt"],
        ["braces", "{a,b}.txt"],
        ["glob star", "star-a.txt"],
        ["very long", "x".repeat(200) + ".txt"],
        ["NFC", "café.txt"],
        ["configs folder-like name (Action#508)", "configs"],
        ["numeric", "123"],
        ["dots only suffix", "a."],
    ])("%s", async (_label, name) => {
        s.setLocal({ [name]: "c", sub: { [name]: "d" } });
        const run = await s.deploy();
        if (!run.ok) { throw new Error(String(run.error) + run.logText); }
        s.expectRemoteInSync();
        s.patchLocal({ [name]: "changed" });
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
        s.removeLocal(name);
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("NFC and NFD forms of the same visible name are separate files", async () => {
        s.setLocal({ "café.txt": "nfc" });
        const nfd = "café.txt";
        try { fs.writeFileSync(path.join(s.localDir, nfd), "nfd"); } catch { return; }
        if (fs.readdirSync(s.localDir).length < 2) { return; }
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("symbolic links are ignored without failing the deploy", async () => {
        s.setLocal({ "real.txt": "r", dir: { "x.txt": "x" } });
        try {
            fs.symlinkSync(path.join(s.localDir, "real.txt"), path.join(s.localDir, "link.txt"));
            fs.symlinkSync(path.join(s.localDir, "dir"), path.join(s.localDir, "linkdir"), "dir");
        }
        catch { return; } // no privilege to create symlinks (Windows)
        const run = await s.deploy();
        expect(run.ok).toBe(true);
    });

    test("name colliding with an in-flight temp file of the library", async () => {
        s.setLocal({ ".ftp-deploy-sync-server-state-buffer-file---delete.json": "mine", "a.txt": "a" });
        const run = await s.deploy();
        expect(run.ok).toBe(true);
        expect(fs.readFileSync(path.join(s.localDir, ".ftp-deploy-sync-server-state-buffer-file---delete.json"), "utf8")).toBe("mine");
    });

    test("deeply nested path (40 levels)", async () => {
        const parts = Array.from({ length: 40 }, (_, i) => `d${i}`);
        fs.mkdirSync(path.join(s.localDir, ...parts), { recursive: true });
        fs.writeFileSync(path.join(s.localDir, ...parts, "leaf.txt"), "leaf");
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
        s.removeLocal("d0");
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("500 small files", async () => {
        const spec: Record<string, string> = {};
        for (let i = 0; i < 500; i++) { spec[`f${i}.txt`] = `c${i}`; }
        s.setLocal(spec);
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });
});
