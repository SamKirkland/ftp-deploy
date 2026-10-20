/**
 * Randomised sequences of local mutations and injected faults. After every healthy deploy the remote must equal local.
 *
 *   FTP_DEPLOY_FUZZ_SEED=1234      replay one seed
 *   FTP_DEPLOY_FUZZ_RUNS=50        number of seeds (default 5)
 *   FTP_DEPLOY_FUZZ_STEPS=15       deploys per seed (default 10)
 *   FTP_DEPLOY_FUZZ_STRICT=1       also generate prefix-name collisions and file<->folder switches (known bugs)
 */
import fs from "fs";
import path from "path";
import { Scenario } from "./harness/scenario";
import { Prng } from "./harness/prng";

jest.setTimeout(10 * 60 * 1000);

const strict = process.env.FTP_DEPLOY_FUZZ_STRICT === "1";
const runs = Number(process.env.FTP_DEPLOY_FUZZ_RUNS ?? 5);
const steps = Number(process.env.FTP_DEPLOY_FUZZ_STEPS ?? 10);
const seeds = process.env.FTP_DEPLOY_FUZZ_SEED !== undefined
    ? [Number(process.env.FTP_DEPLOY_FUZZ_SEED)]
    : Array.from({ length: runs }, (_, i) => 1000 + i);

function listLocal(root: string, rel = ""): { files: string[]; dirs: string[] } {
    const out = { files: [] as string[], dirs: [] as string[] };
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (r === ".ftp-deploy-sync-state.json") { continue; }
        if (entry.isDirectory()) {
            out.dirs.push(r);
            const inner = listLocal(root, r);
            out.files.push(...inner.files);
            out.dirs.push(...inner.dirs);
        }
        else { out.files.push(r); }
    }
    return out;
}

function nest(parts: string[], leaf: string): any {
    return parts.length === 1 ? { [parts[0]]: leaf } : { [parts[0]]: nest(parts.slice(1), leaf) };
}

describe("fuzz", () => {
    test.each(seeds)("seed %d", async seed => {
        const rng = new Prng(seed);
        const s = await Scenario.create();
        const log: string[] = [];
        const names = ["alpha", "beta", "gamma", "delta", "eps", "zeta"];
        const exts = [".txt", ".css", ".js", ""];

        const newPath = () => {
            const depth = rng.int(0, 2);
            const parts = Array.from({ length: depth }, () => rng.pick(names));
            return [...parts, rng.pick(names) + rng.pick(exts)].join("/");
        };

        // collisions of shape (file vs folder) and, unless strict, of sibling names where one prefixes the other are skipped
        const compatible = (rel: string) => {
            const parts = rel.split("/");
            for (let i = 1; i <= parts.length; i++) {
                const p = path.join(s.localDir, parts.slice(0, i).join("/"));
                if (fs.existsSync(p)) {
                    const isDir = fs.statSync(p).isDirectory();
                    if (i < parts.length && !isDir) { return false; }
                    if (i === parts.length && isDir) { return false; }
                }
            }
            if (!strict) {
                const dir = path.join(s.localDir, path.dirname(rel));
                const base = path.basename(rel);
                const siblings = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
                if (siblings.some(n => n !== base && (n.startsWith(base) || base.startsWith(n)))) { return false; }
                // the new name must not prefix or extend a name at any ancestor level either
                for (let i = 0; i < parts.length - 1; i++) {
                    const levelDir = path.join(s.localDir, parts.slice(0, i).join("/"));
                    const sibs = fs.existsSync(levelDir) ? fs.readdirSync(levelDir) : [];
                    if (sibs.some(n => n !== parts[i] && (n.startsWith(parts[i]) || parts[i].startsWith(n)))) { return false; }
                }
            }
            return true;
        };

        try {
            for (let step = 0; step < steps; step++) {
                const mutations = rng.int(1, 4);
                for (let m = 0; m < mutations; m++) {
                    const { files, dirs } = listLocal(s.localDir);
                    const op = rng.pick(["add", "add", "modify", "delete", "deleteDir", "rename", "mkdir"]);
                    if (op === "add") {
                        const p = newPath();
                        if (compatible(p)) {
                            const content = `c${rng.int(0, 5)}`;
                            const parts = p.split("/");
                            s.patchLocal(parts.length === 1 ? { [p]: content } : { [parts[0]]: nest(parts.slice(1), content) });
                            log.push(`add ${p}`);
                        }
                    }
                    else if (op === "modify" && files.length > 0) {
                        const f = rng.pick(files);
                        fs.writeFileSync(path.join(s.localDir, f), `m${rng.int(0, 1000000)}`);
                        log.push(`modify ${f}`);
                    }
                    else if (op === "delete" && files.length > 0) {
                        const f = rng.pick(files);
                        s.removeLocal(f);
                        log.push(`delete ${f}`);
                    }
                    else if (op === "deleteDir" && dirs.length > 0) {
                        const d = rng.pick(dirs);
                        s.removeLocal(d);
                        log.push(`deleteDir ${d}`);
                    }
                    else if (op === "mkdir") {
                        const d = newPath();
                        if (compatible(d) && !fs.existsSync(path.join(s.localDir, d))) {
                            fs.mkdirSync(path.join(s.localDir, d), { recursive: true });
                            log.push(`mkdir ${d}`);
                        }
                    }
                    else if (op === "rename" && files.length > 0) {
                        const f = rng.pick(files);
                        const to = newPath();
                        if (compatible(to)) {
                            s.renameLocal(f, to);
                            log.push(`rename ${f} -> ${to}`);
                        }
                    }
                }

                // sometimes break the connection mid deploy first
                if (rng.chance(0.35)) {
                    const verb = rng.pick(["STOR", "DELE", "MKD", "RMD", "RETR"]);
                    s.server.addRule({ match: verb, action: { type: "drop" }, skip: rng.int(0, 3), times: 1 });
                    log.push(`fault drop ${verb}`);
                    await s.deploy({ timeout: 3000 });
                    s.server.clearRules();
                }

                const run = await s.deploy({ timeout: 5000 });
                if (!run.ok) { throw new Error(`step ${step} deploy failed: ${run.error}\n${run.logText}`); }
                s.expectRemoteInSync();
            }
        }
        catch (e) {
            throw new Error(`fuzz seed ${seed} failed (replay with FTP_DEPLOY_FUZZ_SEED=${seed})\nactions:\n  ${log.join("\n  ")}\n${(e as Error).message}`);
        }
        finally {
            await s.destroy();
        }
    });
});
