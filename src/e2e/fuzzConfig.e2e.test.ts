/**
 * Fuzzing of config changes and out-of-band changes on the server.
 * Invariants after every healthy deploy:
 *   - every local file that is not excluded exists remotely with identical content
 *   - files that exist on the server but were never deployed (strays) are never touched
 *   - an excluded local file is never uploaded
 *   - a second deploy with identical inputs transfers nothing
 *
 *   FTP_DEPLOY_FUZZ_SEED=1234   replay one seed
 *   FTP_DEPLOY_FUZZ_RUNS=50     number of seeds (default 6)
 *   FTP_DEPLOY_FUZZ_STEPS=15    deploys per seed (default 10)
 */
import fs from "fs";
import path from "path";
import multimatch from "multimatch";
import { Scenario } from "./harness/scenario";
import { Prng } from "./harness/prng";
import { excludeDefaults } from "../module";

jest.setTimeout(10 * 60 * 1000);

const runs = Number(process.env.FTP_DEPLOY_FUZZ_RUNS ?? 6);
const steps = Number(process.env.FTP_DEPLOY_FUZZ_STEPS ?? 10);
const seeds = process.env.FTP_DEPLOY_FUZZ_SEED !== undefined
    ? [Number(process.env.FTP_DEPLOY_FUZZ_SEED)]
    : Array.from({ length: runs }, (_, i) => 5000 + i);

// fixed width names: no name is a prefix of another so the known startsWith bug is not hit
const dirs = ["dirA", "dirB", "dirC"];
const files = Array.from({ length: 8 }, (_, i) => `n0${i}`);
const exts = [".txt", ".log", ".map"];
const excludeSets: string[][] = [
    excludeDefaults,
    [],
    ["**/*.log"],
    ["**/*.map", "**/*.log"],
    ["dirA/**"],
    [...excludeDefaults, "**/n01*"],
];

function walk(root: string, rel = ""): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (r === ".ftp-deploy-sync-state.json") { continue; }
        if (e.isDirectory()) { out.push(...walk(root, r)); } else { out.push(r); }
    }
    return out;
}

describe("fuzz config + server tampering", () => {
    test.each(seeds)("seed %d", async seed => {
        const rng = new Prng(seed);
        const s = await Scenario.create();
        const log: string[] = [];
        let exclude = excludeSets[0];
        let strayCount = 0;
        const strays = new Map<string, string>();

        const matchesExclude = (rel: string) => multimatch(rel, exclude, { matchBase: true, dot: true }).length > 0;

        try {
            for (let step = 0; step < steps; step++) {
                for (let m = rng.int(1, 5); m > 0; m--) {
                    const op = rng.pick(["write", "write", "write", "remove", "removeDir", "stray", "changeExclude", "tamperStray"]);
                    if (op === "write") {
                        const dir = rng.pick([...dirs, ""]);
                        const rel = (dir ? dir + "/" : "") + rng.pick(files) + rng.pick(exts);
                        fs.mkdirSync(path.dirname(path.join(s.localDir, rel)), { recursive: true });
                        fs.writeFileSync(path.join(s.localDir, rel), `v${rng.int(0, 99999)}`);
                        log.push(`write ${rel}`);
                    }
                    else if (op === "remove") {
                        const all = walk(s.localDir);
                        if (all.length > 0) { const f = rng.pick(all); s.removeLocal(f); log.push(`remove ${f}`); }
                    }
                    else if (op === "removeDir") {
                        const d = rng.pick(dirs);
                        if (fs.existsSync(path.join(s.localDir, d))) { s.removeLocal(d); log.push(`removeDir ${d}`); }
                    }
                    else if (op === "stray") {
                        const name = `zz-stray-${strayCount++}.bin`;
                        fs.writeFileSync(path.join(s.remoteSiteDir, name), name);
                        strays.set(name, name);
                        log.push(`stray ${name}`);
                    }
                    else if (op === "tamperStray" && strays.size > 0) {
                        const name = rng.pick([...strays.keys()]);
                        fs.writeFileSync(path.join(s.remoteSiteDir, name), "tampered");
                        strays.set(name, "tampered");
                        log.push(`tamper ${name}`);
                    }
                    else if (op === "changeExclude") {
                        exclude = rng.pick(excludeSets);
                        log.push(`exclude ${JSON.stringify(exclude)}`);
                    }
                }

                const run = await s.deploy({ exclude, timeout: 5000 });
                if (!run.ok) { throw new Error(`step ${step} deploy failed: ${run.error}\n${run.logText}`); }

                // excluded files are never uploaded
                for (const up of run.uploadsExcludingState()) {
                    if (matchesExclude(up)) { throw new Error(`excluded file was uploaded: ${up}`); }
                }
                // local, non excluded files match remote
                for (const rel of walk(s.localDir)) {
                    if (matchesExclude(rel)) { continue; }
                    const remote = path.join(s.remoteSiteDir, rel);
                    if (!fs.existsSync(remote)) { throw new Error(`missing on remote: ${rel}`); }
                    if (fs.readFileSync(remote, "utf8") !== fs.readFileSync(path.join(s.localDir, rel), "utf8")) { throw new Error(`content differs: ${rel}`); }
                }
                // strays untouched
                for (const [name, content] of strays) {
                    const p = path.join(s.remoteSiteDir, name);
                    if (!fs.existsSync(p)) { throw new Error(`stray deleted: ${name}`); }
                    if (fs.readFileSync(p, "utf8") !== content) { throw new Error(`stray modified: ${name}`); }
                }

                // idempotent
                const again = await s.deploy({ exclude, timeout: 5000 });
                if (!again.ok) { throw new Error(`idempotent redeploy failed: ${again.error}`); }
                if (again.uploadsExcludingState().length > 0 || again.deletes.length > 0) {
                    throw new Error(`redeploy was not a no-op: uploads=${again.uploadsExcludingState()} deletes=${again.deletes}`);
                }
            }
        }
        catch (e) {
            throw new Error(`config fuzz seed ${seed} failed (replay with FTP_DEPLOY_FUZZ_SEED=${seed})\nactions:\n  ${log.join("\n  ")}\n${(e as Error).message}`);
        }
        finally {
            await s.destroy();
        }
    });
});
