/**
 * Unusual file names and contents.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Scenario } from "./harness/scenario";

jest.setTimeout(60000);

describe("edge case content", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test("names with spaces, unicode, dots and symbols", async () => {
        s.setLocal({
            "with space.txt": "1",
            "ünïcödé.txt": "2",
            "日本語.txt": "3",
            "emoji-😀.txt": "4",
            ".hidden": "5",
            "multi.dot.name.tar.gz": "6",
            "semi;colon&amp=#hash%percent.txt": "7",
            "folder with space": { "inner file.txt": "8" },
        });
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();

        const run = (await s.deploy()).expectOk();
        expect(run.uploadsExcludingState()).toEqual([]);
        s.removeLocal("with space.txt").removeLocal("日本語.txt").removeLocal("folder with space");
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
    });

    test("zero byte files", async () => {
        s.setLocal({ "empty.txt": "", dir: { "empty2.txt": "" } });
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
        expect((await s.deploy()).expectOk().uploadsExcludingState()).toEqual([]);
    });

    test("binary content survives byte for byte", async () => {
        const bytes = crypto.randomBytes(200_000);
        fs.writeFileSync(path.join(s.localDir, "random.bin"), bytes);
        (await s.deploy()).expectOk();

        expect(fs.readFileSync(path.join(s.remoteSiteDir, "random.bin")).equals(bytes)).toBe(true);
    });

    test("every byte value", async () => {
        const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        fs.writeFileSync(path.join(s.localDir, "all-bytes.bin"), bytes);
        (await s.deploy()).expectOk();

        expect(fs.readFileSync(path.join(s.remoteSiteDir, "all-bytes.bin")).equals(bytes)).toBe(true);
    });

    test("CRLF and LF line endings are not rewritten", async () => {
        fs.writeFileSync(path.join(s.localDir, "crlf.txt"), "a\r\nb\r\n");
        fs.writeFileSync(path.join(s.localDir, "lf.txt"), "a\nb\n");
        (await s.deploy()).expectOk();

        expect(fs.readFileSync(path.join(s.remoteSiteDir, "crlf.txt"), "utf8")).toBe("a\r\nb\r\n");
        expect(fs.readFileSync(path.join(s.remoteSiteDir, "lf.txt"), "utf8")).toBe("a\nb\n");
    });

    test("changing only line endings is detected", async () => {
        fs.writeFileSync(path.join(s.localDir, "f.txt"), "a\nb\n");
        (await s.deploy()).expectOk();
        fs.writeFileSync(path.join(s.localDir, "f.txt"), "a\r\nb\r\n");
        const run = (await s.deploy()).expectOk();

        expect(run.uploadsExcludingState()).toEqual(["f.txt"]);
    });

    test("5MB file", async () => {
        const bytes = crypto.randomBytes(5 * 1024 * 1024);
        fs.writeFileSync(path.join(s.localDir, "big.bin"), bytes);
        (await s.deploy({ timeout: 30000 })).expectOk();

        expect(fs.readFileSync(path.join(s.remoteSiteDir, "big.bin")).equals(bytes)).toBe(true);
    });

    test("deeply nested folders", async () => {
        let spec: any = { "leaf.txt": "leaf" };
        for (let i = 0; i < 25; i++) { spec = { [`level${i}`]: spec }; }
        s.setLocal(spec);
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();

        s.removeLocal("level24");
        (await s.deploy()).expectOk();
        s.expectRemote({});
    });

    test("many files", async () => {
        const files: Record<string, string> = {};
        for (let i = 0; i < 300; i++) { files[`f${i}.txt`] = `content ${i}`; }
        s.setLocal({ many: files });
        (await s.deploy({ timeout: 30000 })).expectOk();
        s.expectRemoteInSync();

        s.patchLocal({ many: { "f7.txt": "changed" } });
        const run = (await s.deploy()).expectOk();
        expect(run.uploadsExcludingState()).toEqual(["many/f7.txt"]);
    });

    test("file named like the state file in a sub folder is a normal file", async () => {
        s.setLocal({ sub: { ".ftp-deploy-sync-state.json": "{}" } });
        (await s.deploy()).expectOk();
        expect(s.remoteExists("sub/.ftp-deploy-sync-state.json")).toBe(true);
    });

    test("local-dir without trailing slash is rejected", async () => {
        s.setLocal({ "a.txt": "a" });
        await expect(s.deploy({ "local-dir": s.localDir.slice(0, -1) })).rejects.toThrow(/must end with \//);
    });

    test("server-dir without trailing slash is rejected", async () => {
        s.setLocal({ "a.txt": "a" });
        await expect(s.deploy({ "server-dir": "sub" })).rejects.toThrow(/must end with \//);
    });
});
