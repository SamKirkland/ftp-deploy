/** "uploading files that start with . fail" */
import { Scenario } from "./harness/scenario";

jest.setTimeout(60000);

describe("dotfiles", () => {
    let s: Scenario;
    afterEach(async () => { await s?.destroy(); });

    const tree = { ".htaccess": "h", ".env": "e", ".well-known": { "x.txt": "x", ".hid": "y" }, d: { ".dot": "z", "..x": "w", ".a.b.c": "q" }, "a.txt": "a" };

    test("dotfiles and dot folders upload, update, delete and converge", async () => {
        s = await Scenario.create();
        s.setLocal(tree);
        (await s.deploy()).expectOk();
        s.expectRemoteInSync();
        s.patchLocal({ ".htaccess": "h2", d: { ".dot": "z2" } });
        s.removeLocal(".env");
        s.removeLocal(".well-known");
        const run = (await s.deploy()).expectOk();
        expect(run.deletes).toEqual(expect.arrayContaining([".env"]));
        s.expectRemoteInSync();
        expect((await s.deploy()).expectOk().uploadsExcludingState()).toEqual([]);
    });

    test("dotfiles work when server-dir is used and when LIST is unavailable", async () => {
        s = await Scenario.create({ server: { disabledCommands: ["LIST", "MLSD"] } });
        s.setLocal(tree);
        (await s.deploy({ "server-dir": "site/" })).expectOk();
        expect(s.remoteExists("site/.htaccess")).toBe(true);
    });

    // the default exclude "**/.git*" also hides legitimate files such as .gitkeep, .gitattributes, .github workflows, .git-credentials-like names
    test("default excludes hide every dotfile starting with .git (documented behaviour)", async () => {
        s = await Scenario.create();
        s.setLocal({ ".gitkeep": "", ".gitattributes": "g", ".gitmodules": "m", ".github": { "w.yml": "w" }, ".gitlab-ci.yml": "c", "a.txt": "a" });
        const run = (await s.deploy()).expectOk();
        expect(run.uploadsExcludingState()).toEqual(["a.txt"]);
    });

    test("overriding exclude lets .git* dotfiles upload", async () => {
        s = await Scenario.create();
        s.setLocal({ ".gitkeep": "", ".gitattributes": "g", d: { ".gitkeep": "" } });
        (await s.deploy({ exclude: [] })).expectOk();
        s.expectRemoteInSync([]);
    });
});
