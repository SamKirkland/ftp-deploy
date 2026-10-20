/**
 * Reproductions of suspected library bugs found by reading the code.
 *
 * Each uses `test.failing`: the test body asserts the CORRECT behaviour, jest reports it as passing while the bug exists
 * and as failing once it is fixed. When that happens just change `test.failing` to `test`.
 */
import { Scenario } from "./harness/scenario";
import { HashDiff } from "../HashDiff";
import { currentSyncFileVersion, IFileList, Record as FileRecord } from "../types";

jest.setTimeout(30000);

const list = (...data: FileRecord[]): IFileList => ({ description: "", version: currentSyncFileVersion, generatedTime: 0, data });
const file = (name: string, hash = "h"): FileRecord => ({ type: "file", name, size: 1, hash });
const folder = (name: string): FileRecord => ({ type: "folder", name } as FileRecord);

describe("HashDiff unit-level bugs", () => {
    test.failing("deleting folder 'a' must not swallow the delete of sibling file 'ab.txt'", () => {
        const diff = new HashDiff().getDiffs(list(), list(folder("a"), file("a/x.txt"), file("ab.txt")));
        expect(diff.delete.map(d => d.name).sort()).toEqual(["a", "ab.txt"]);
    });

    test.failing("file replaced by a folder of the same name is handled (old file deleted, folder created)", () => {
        const diff = new HashDiff().getDiffs(list(folder("x"), file("x/y.txt")), list(file("x")));
        expect(diff.delete.map(d => d.name)).toContain("x");
        expect(diff.upload.map(d => d.name)).toEqual(expect.arrayContaining(["x", "x/y.txt"]));
    });
});

describe("end-to-end bugs", () => {
    let s: Scenario;
    afterEach(async () => { await s.destroy(); });

    test.failing("folder 'a' deleted locally while sibling 'ab.txt' also deleted => both gone from the server", async () => {
        s = await Scenario.create();
        s.setLocal({ a: { "x.txt": "x" }, "ab.txt": "ab", keep: "k" });
        (await s.deploy()).expectOk();

        s.removeLocal("a").removeLocal("ab.txt");
        (await s.deploy()).expectOk();

        s.expectRemoteInSync();
    });

    test.failing("file turned into folder with the same name", async () => {
        s = await Scenario.create();
        s.setLocal({ thing: "i am a file" });
        (await s.deploy()).expectOk();

        s.setLocal({ thing: { "inner.txt": "now a folder" } });
        (await s.deploy()).expectOk();

        s.expectRemoteInSync();
    });

    test.failing("folder turned into file with the same name", async () => {
        s = await Scenario.create();
        s.setLocal({ thing: { "inner.txt": "folder" } });
        (await s.deploy()).expectOk();

        s.setLocal({ thing: "now a file" });
        (await s.deploy()).expectOk();

        s.expectRemoteInSync();
    });

    test.failing("server-dir used with a login home that is not the ftp root: deleted folders are really removed", async () => {
        s = await Scenario.create({ server: { home: "/home/user" }, remoteDir: "home/user/www" });
        const fs = await import("fs");
        const path = await import("path");
        fs.mkdirSync(path.join(s.remoteRoot, "home/user"), { recursive: true });

        s.setLocal({ gone: { "g.txt": "g" }, keep: "k" });
        (await s.deploy({ "server-dir": "www/" })).expectOk();
        s.removeLocal("gone");
        (await s.deploy({ "server-dir": "www/" })).expectOk();

        expect(s.remoteExists("gone")).toBe(false);
    });
});
