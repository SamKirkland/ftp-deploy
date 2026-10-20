import { Scenario } from "./harness/scenario";

jest.setTimeout(30000);

describe("smoke", () => {
    let s: Scenario;
    beforeEach(async () => { s = await Scenario.create(); });
    afterEach(async () => { await s.destroy(); });

    test("first deploy then no-op redeploy", async () => {
        s.setLocal({ "index.html": "hi", assets: { "a.css": "body{}" }, empty: {} });
        const first = (await s.deploy()).expectOk();
        s.expectRemoteInSync();
        expect(s.readRemoteState().data.length).toBe(4);

        s.server.resetCommandLog();
        const second = (await s.deploy()).expectOk();
        expect(second.uploadsExcludingState()).toEqual([]);
    });

    test.each(["explicit", "implicit"] as const)("tls %s", async (tls) => {
        const t = await Scenario.create({ server: { tls } });
        try {
            t.setLocal({ "index.html": "hi" });
            const run = await t.deploy();
            run.expectOk();
            t.expectRemoteInSync();
        } finally { await t.destroy(); }
    });
});
