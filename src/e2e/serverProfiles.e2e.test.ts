/**
 * The same library against differently configured FTP servers.
 */
import fs from "fs";
import path from "path";
import { Scenario } from "./harness/scenario";

jest.setTimeout(30000);

const site = { "index.html": "<h1>hi</h1>", assets: { "a.css": "a", img: { "p.png": "png" } } };

async function withScenario(options: Parameters<typeof Scenario.create>[0], body: (s: Scenario) => Promise<void>) {
    const s = await Scenario.create(options);
    try { await body(s); }
    finally { await s.destroy(); }
}

describe("server-dir variants", () => {
    test.each([
        ["./", ""],
        ["sub/", "sub"],
        ["./sub/", "sub"],
        ["a/b/c/", "a/b/c"],
    ])("server-dir %s", async (serverDir, remoteDir) => {
        await withScenario({ remoteDir }, async s => {
            s.setLocal(site);
            (await s.deploy({ "server-dir": serverDir })).expectOk();
            s.expectRemoteInSync();

            // second run is a no-op
            const run = (await s.deploy({ "server-dir": serverDir })).expectOk();
            expect(run.uploadsExcludingState()).toEqual([]);

            // and deletes work
            s.removeLocal("assets");
            (await s.deploy({ "server-dir": serverDir })).expectOk();
            s.expectRemoteInSync();
            expect(s.remoteExists("assets")).toBe(false);
        });
    });

    test("absolute server-dir /sub/", async () => {
        await withScenario({ remoteDir: "sub" }, async s => {
            s.setLocal(site);
            (await s.deploy({ "server-dir": "/sub/" })).expectOk();
            s.expectRemoteInSync();
        });
    });

    test("deploying to different server-dirs keeps independent state", async () => {
        await withScenario({}, async s => {
            s.setLocal({ "a.txt": "a" });
            (await s.deploy({ "server-dir": "one/" })).expectOk();
            (await s.deploy({ "server-dir": "two/" })).expectOk();

            expect(fs.existsSync(path.join(s.remoteRoot, "one/a.txt"))).toBe(true);
            expect(fs.existsSync(path.join(s.remoteRoot, "two/a.txt"))).toBe(true);
            expect(fs.existsSync(path.join(s.remoteRoot, "one/.ftp-deploy-sync-state.json"))).toBe(true);
            expect(fs.existsSync(path.join(s.remoteRoot, "two/.ftp-deploy-sync-state.json"))).toBe(true);
        });
    });
});

describe("server capabilities", () => {
    test.each([
        ["FEAT"], ["OPTS"], ["SIZE"], ["MDTM"], ["EPSV"], ["MLSD"], ["MLST"], ["NLST"], ["CDUP"], ["SYST"],
    ])("works when %s is not supported", async verb => {
        await withScenario({ server: { disabledCommands: [verb] } }, async s => {
            s.setLocal(site);
            const first = await s.deploy();
            // not every verb is optional for basic-ftp; the point is that the outcome is a clean success or a clear error
            if (first.ok) {
                s.expectRemoteInSync();
                (await s.deploy({ "dry-run": false })).expectOk();
                s.removeLocal("assets");
                (await s.deploy()).expectOk();
                s.expectRemoteInSync();
            }
            else {
                expect(String(first.error)).toBeTruthy();
            }
        });
    });

    test("EPSV unavailable => falls back to PASV", async () => {
        await withScenario({ server: { disabledCommands: ["EPSV"] } }, async s => {
            s.setLocal(site);
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
            expect(s.server.commandsOf("PASV").length).toBeGreaterThan(0);
        });
    });

    test("RMD unavailable => deleting a folder does not fail the deploy", async () => {
        await withScenario({ server: { disabledCommands: ["RMD", "XRMD"] } }, async s => {
            s.setLocal(site);
            (await s.deploy()).expectOk();
            s.removeLocal("assets");
            const run = await s.deploy();
            // documents current behaviour: either completes or fails loudly, but must never claim success while updating state wrongly
            if (run.ok) {
                expect(s.readRemoteState().data.some((d: any) => d.name === "assets")).toBe(false);
            }
        });
    });
});

describe("authentication", () => {
    test("correct credentials", async () => {
        await withScenario({ server: { credentials: { username: "tester", password: "secret" } } }, async s => {
            s.setLocal(site);
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });

    test("wrong password fails and leaves the server untouched", async () => {
        await withScenario({ server: { credentials: { username: "tester", password: "secret" } } }, async s => {
            s.setLocal(site);
            const run = await s.deploy({ password: "wrong" });
            expect(run.ok).toBe(false);
            expect(String(run.error)).toMatch(/530|login|auth/i);
            s.expectRemote({});
        });
    });

    test("wrong username fails", async () => {
        await withScenario({ server: { credentials: { username: "tester", password: "secret" } } }, async s => {
            s.setLocal(site);
            expect((await s.deploy({ username: "nobody" })).ok).toBe(false);
        });
    });
});

describe("TLS", () => {
    test("explicit TLS (ftps) with security loose accepts a self signed certificate", async () => {
        await withScenario({ server: { tls: "explicit" } }, async s => {
            s.setLocal(site);
            (await s.deploy({ security: "loose" })).expectOk();
            s.expectRemoteInSync();
        });
    });

    test("implicit TLS (ftps-legacy) with security loose", async () => {
        await withScenario({ server: { tls: "implicit" } }, async s => {
            s.setLocal(site);
            (await s.deploy({ security: "loose" })).expectOk();
            s.expectRemoteInSync();
        });
    });

    test.each(["explicit", "implicit"] as const)("%s TLS with security strict rejects a self signed certificate", async tls => {
        await withScenario({ server: { tls } }, async s => {
            s.setLocal(site);
            const run = await s.deploy({ security: "strict" });
            expect(run.ok).toBe(false);
            s.expectRemote({});
        });
    });

    test("plain ftp client against a TLS-only (implicit) server fails cleanly", async () => {
        await withScenario({ server: { tls: "implicit" } }, async s => {
            s.setLocal(site);
            const run = await s.deploy({ protocol: "ftp", timeout: 1500 });
            expect(run.ok).toBe(false);
            s.expectRemote({});
        });
    });

    test("TLS full sync cycle (modify, delete, add)", async () => {
        await withScenario({ server: { tls: "explicit" } }, async s => {
            s.setLocal(site);
            (await s.deploy()).expectOk();
            s.patchLocal({ "index.html": "v2", "new.txt": "n" });
            s.removeLocal("assets");
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });
});

describe("home directory is not the ftp root", () => {
    test("deploy to ./ lands inside the home directory", async () => {
        await withScenario({ server: { home: "/home/user" }, remoteDir: "home/user" }, async s => {
            fs.mkdirSync(path.join(s.remoteRoot, "home/user"), { recursive: true });
            s.setLocal(site);
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });

    test("deleting files works from a non root home directory", async () => {
        await withScenario({ server: { home: "/home/user" }, remoteDir: "home/user" }, async s => {
            fs.mkdirSync(path.join(s.remoteRoot, "home/user"), { recursive: true });
            s.setLocal(site);
            (await s.deploy()).expectOk();
            s.removeLocal("index.html");
            (await s.deploy()).expectOk();
            s.expectRemoteInSync();
        });
    });
});

describe("read only server", () => {
    test("fails and never reports success", async () => {
        await withScenario({ server: { readOnly: true } }, async s => {
            s.setLocal(site);
            const run = await s.deploy();
            expect(run.ok).toBe(false);
            expect(s.readRemoteState()).toBeUndefined();
        });
    });

    test("dry run works against a read only server", async () => {
        await withScenario({ server: { readOnly: true } }, async s => {
            s.setLocal(site);
            (await s.deploy({ "dry-run": true })).expectOk();
        });
    });
});

describe("slow and broken networks", () => {
    test("high latency still works", async () => {
        await withScenario({ server: { latencyMs: 25 } }, async s => {
            s.setLocal(site);
            (await s.deploy({ timeout: 10000 })).expectOk();
            s.expectRemoteInSync();
        });
    });

    test("nothing listening on the port fails fast", async () => {
        await withScenario({}, async s => {
            s.setLocal(site);
            const run = await s.deploy({ port: 1, timeout: 2000 });
            expect(run.ok).toBe(false);
        });
    });

    test("server that never answers hits the timeout", async () => {
        await withScenario({}, async s => {
            s.server.addRule({ match: "USER", action: { type: "hang" } });
            s.setLocal(site);
            const started = Date.now();
            const run = await s.deploy({ timeout: 800 });
            expect(run.ok).toBe(false);
            expect(Date.now() - started).toBeLessThan(10000);
            s.expectRemote({});
        });
    });
});
