/**
 * Performance probes. Wall clock is flaky, so these assert round trips (commands sent, which dominate on a real network)
 * and scaling ratios rather than absolute times.
 */
import fs from "fs";
import path from "path";
import { Scenario } from "./harness/scenario";
import { HashDiff } from "../HashDiff";

jest.setTimeout(120000);

const rec = (name: string, type: "file" | "folder" = "file") => ({ type, name, size: 1, hash: "h" } as any);
const meta = { version: "1.0.0", description: "" };
const hist = (cmds: { directive: string }[]) => cmds.reduce((a: Record<string, number>, c) => (a[c.directive] = (a[c.directive] ?? 0) + 1, a), {});

describe("performance", () => {
    let s: Scenario;
    afterEach(async () => { await s?.destroy(); });

    function manyFiles(count: number, dirs: number) {
        for (let i = 0; i < count; i++) {
            const d = path.join(s.localDir, `d${i % dirs}`);
            fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(path.join(d, `f${i}.txt`), "x".repeat(50));
        }
    }

    test("a no-op deploy of 500 files costs a constant number of commands", async () => {
        s = await Scenario.create();
        manyFiles(500, 25);
        (await s.deploy({ timeout: 30000 })).expectOk();
        const run = (await s.deploy({ timeout: 30000 })).expectOk();
        expect(run.commands.length).toBeLessThan(20);
    });

    test("first publish costs at most 2 data-channel commands per file and 3 per folder", async () => {
        s = await Scenario.create();
        manyFiles(300, 30);
        const run = (await s.deploy({ timeout: 30000 })).expectOk();
        const h = hist(run.commands);
        expect(h.STOR).toBe(301);
        expect(h.EPSV + (h.PASV ?? 0)).toBeLessThanOrEqual(305);
        expect(run.commands.length).toBeLessThan(300 * 2 + 30 * 3 + 40);
    });

    test("changing one file in a big site sends one STOR for it plus the state", async () => {
        s = await Scenario.create();
        manyFiles(300, 30);
        (await s.deploy({ timeout: 30000 })).expectOk();
        s.patchLocal({ d3: { "f3.txt": "changed" } });
        const run = (await s.deploy({ timeout: 30000 })).expectOk();
        expect(run.uploadsExcludingState()).toEqual(["d3/f3.txt"]);
        expect(run.commands.length).toBeLessThan(25);
    });

    test("many sibling empty folders cost a constant number of commands each", async () => {
        s = await Scenario.create();
        for (let i = 0; i < 200; i++) { fs.mkdirSync(path.join(s.localDir, `e${i}`)); }
        const run = (await s.deploy({ timeout: 30000 })).expectOk();
        expect(run.commands.length).toBeLessThan(200 * 4 + 30);
    });

    // every level of a new deep path used to be created by re-walking the whole path from the root, so N levels cost ~N^2 commands
    const deepDeploy = async (depth: number) => {
        s = await Scenario.create();
        const deep = Array.from({ length: depth }, (_, i) => `l${i}`).join("/");
        s.setLocal({ [deep]: { "a.txt": "a" } });
        return (await s.deploy({ timeout: 60000 })).expectOk();
    };

    test("creating a new 10 level deep path works and stays under 400 commands", async () => {
        expect((await deepDeploy(10)).commands.length).toBeLessThan(400);
    });

    for (const depth of [20, 30, 50]) {
        test(`creating a new ${depth} level deep path is linear in depth`, async () => {
            expect((await deepDeploy(depth)).commands.length).toBeLessThan(depth * 8 + 30);
        });
    }

    test("deep path cost grows linearly", async () => {
        const counts: number[] = [];
        for (const depth of [10, 20]) {
            s = await Scenario.create();
            const deep = Array.from({ length: depth }, (_, i) => `l${i}`).join("/");
            s.setLocal({ [deep]: { "a.txt": "a" } });
            counts.push((await s.deploy({ timeout: 60000 })).expectOk().commands.length);
            await s.destroy();
        }
        s = await Scenario.create();
        // doubling depth at most doubles the cost (quadratic would be ~4x)
        expect(counts[1] / counts[0]).toBeLessThan(2.5);
    });

    test("deleting a deep tree is linear in depth", async () => {
        s = await Scenario.create();
        const deep = Array.from({ length: 20 }, (_, i) => `l${i}`).join("/");
        s.setLocal({ [deep]: { "a.txt": "a" }, "keep.txt": "k" });
        (await s.deploy({ timeout: 60000 })).expectOk();
        s.removeLocal("l0");
        const run = (await s.deploy({ timeout: 60000 })).expectOk();
        expect(run.commands.length).toBeLessThan(20 * 8 + 30);
    });

    test("latency: round trips, not bytes, decide the time (20ms latency, 100 files)", async () => {
        s = await Scenario.create({ server: { latencyMs: 20 } });
        manyFiles(100, 10);
        const started = Date.now();
        const run = (await s.deploy({ timeout: 60000 })).expectOk();
        const per = (Date.now() - started) / run.commands.length;
        // sequential: every command waits for its reply, so time ~ commands * latency. Guards against extra hidden waits
        expect(per).toBeLessThan(80);
    });

    describe("HashDiff scaling", () => {
        const time = (fn: () => void) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
        const diff = (local: any[], server: any[]) => new HashDiff().getDiffs({ ...meta, data: local } as any, { ...meta, data: server } as any);

        test("diffing 40000 new files finishes quickly", () => {
            const local = Array.from({ length: 40000 }, (_, i) => rec(`dir${i % 100}/file${i}.txt`));
            expect(time(() => diff(local, []))).toBeLessThan(3000);
        });

        test("diffing 40000 unchanged files finishes quickly", () => {
            const mk = () => Array.from({ length: 40000 }, (_, i) => rec(`dir${i % 100}/file${i}.txt`));
            expect(time(() => diff(mk(), mk()))).toBeLessThan(3000);
        });

        // Regression (was a bug): the "skip children of deleted folders" pass compares every deleted item with every deleted folder (O(n*m)).
        // 4x more deletes takes ~16x longer; 50000 deletes with 10000 folders takes over a second
        test("deleting many files and folders scales roughly linearly", () => {
            const build = (n: number) => {
                const folders = Array.from({ length: n / 5 }, (_, i) => rec(`f${i}`, "folder"));
                const files = Array.from({ length: n }, (_, i) => rec(`x${i}.txt`));
                return [...folders, ...files];
            };
            diff([], build(2000)); // warm up
            const small = Math.max(time(() => diff([], build(10000))), 1);
            const large = time(() => diff([], build(40000)));
            expect(large / small).toBeLessThan(8); // linear = 4, quadratic = 16
        });
    });
});
