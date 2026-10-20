import fs from "fs";
import os from "os";
import path from "path";
import { deploy } from "../../deploy";
import { IFtpDeployArguments } from "../../types";
import { applyExcludeFilter, getDefaultSettings, ILogger, Timings } from "../../utilities";
import { diffTrees, FlatTree, flattenSpec, readTree, removeTree, sortTree, TreeSpec, writeTree } from "./fsTree";
import { CommandRecord, TestFtpServer, TestServerOptions } from "./testServer";

export const DEFAULT_STATE_NAME = ".ftp-deploy-sync-state.json";

export class CapturingLogger implements ILogger {
    readonly lines: string[] = [];
    private push(data: any[]) { this.lines.push(data.map(d => (d instanceof Error ? `${d.name}: ${d.message}` : String(d))).join(" ")); }
    all(...data: any[]) { this.push(data); }
    standard(...data: any[]) { this.push(data); }
    verbose(...data: any[]) { this.push(data); }

    get text() { return this.lines.join("\n"); }
}

/** Everything observable about a single deploy() call */
export class DeployRun {
    constructor(
        readonly error: unknown,
        readonly logger: CapturingLogger,
        readonly commands: CommandRecord[],
    ) { }

    get ok() { return this.error === undefined; }
    get logText() { return this.logger.text; }

    private args(...directives: string[]) { return this.commands.filter(c => directives.includes(c.directive)).map(c => c.arg ?? ""); }
    /** paths sent with STOR */
    get uploads() { return this.args("STOR"); }
    /** paths sent with DELE */
    get deletes() { return this.args("DELE"); }
    get removedDirs() { return this.args("RMD", "XRMD"); }
    get madeDirs() { return this.args("MKD", "XMKD"); }
    /** uploads excluding the sync-state file */
    uploadsExcludingState(stateName = DEFAULT_STATE_NAME) { return this.uploads.filter(u => u !== stateName); }
    get connections() { return new Set(this.commands.map(c => c.connectionId)).size; }

    /** throws (with the deploy log attached) when the deploy failed */
    expectOk(): this {
        if (this.error !== undefined) {
            throw new Error(`deploy was expected to succeed but threw: ${this.error}\n--- deploy log ---\n${this.logText}`);
        }
        return this;
    }
}

export interface ScenarioOptions {
    server?: Partial<Omit<TestServerOptions, "root">>;
    /** Sub directory of the ftp root that holds the deployed site. Used by assertions only, the deploy `server-dir` argument is set per deploy. @default "" */
    remoteDir?: string;
}

/**
 * One isolated sandbox = local directory + remote directory served by a real FTP server.
 *
 *   const s = await Scenario.create();
 *   s.setLocal({ "index.html": "v1" });
 *   (await s.deploy()).expectOk();
 *   s.expectRemoteInSync();
 */
export class Scenario {
    private constructor(
        readonly sandbox: string,
        readonly server: TestFtpServer,
        private readonly remoteDir: string,
        private readonly previousCwd: string,
    ) { }

    static async create(options: ScenarioOptions = {}): Promise<Scenario> {
        const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ftp-deploy-e2e-")));
        fs.mkdirSync(path.join(sandbox, "local"));
        fs.mkdirSync(path.join(sandbox, "remote"));
        fs.mkdirSync(path.join(sandbox, "cwd"));

        const server = new TestFtpServer({ ...options.server, root: path.join(sandbox, "remote") });
        await server.start();

        // ftp-deploy downloads the server state to a temp file in process.cwd(), isolate it so parallel test files never collide
        const previousCwd = process.cwd();
        process.chdir(path.join(sandbox, "cwd"));

        return new Scenario(sandbox, server, options.remoteDir ?? "", previousCwd);
    }

    async destroy(): Promise<void> {
        process.chdir(this.previousCwd);
        await this.server.stop();
        removeTree(this.sandbox);
    }

    // ---- paths ------------------------------------------------------------------------------

    /** local-dir argument: absolute, forward slashes, trailing slash */
    get localDir(): string { return path.join(this.sandbox, "local").replace(/\\/g, "/") + "/"; }
    get remoteRoot(): string { return path.join(this.sandbox, "remote"); }
    /** where the deployed files end up on disk */
    get remoteSiteDir(): string { return path.join(this.remoteRoot, this.remoteDir); }
    /** leftovers the library writes into process.cwd() */
    get cwdDir(): string { return path.join(this.sandbox, "cwd"); }

    // ---- local state ----------------------------------------------------------------------

    /** replaces the whole local directory with this tree */
    setLocal(spec: TreeSpec): this {
        for (const entry of fs.readdirSync(this.localDir)) {
            fs.rmSync(path.join(this.localDir, entry), { recursive: true, force: true });
        }
        writeTree(this.localDir, spec);
        return this;
    }

    /** adds/overwrites files, creating parent folders. Pass a tree spec relative to local-dir. */
    patchLocal(spec: TreeSpec): this {
        writeTree(this.localDir, spec);
        return this;
    }

    removeLocal(relativePath: string): this {
        fs.rmSync(path.join(this.localDir, relativePath), { recursive: true, force: true });
        return this;
    }

    renameLocal(from: string, to: string): this {
        fs.mkdirSync(path.dirname(path.join(this.localDir, to)), { recursive: true });
        fs.renameSync(path.join(this.localDir, from), path.join(this.localDir, to));
        return this;
    }

    // ---- remote state (changes made "behind the library's back") -------------------------------

    /** writes files straight into the served directory, bypassing ftp-deploy (e.g. a colleague uploaded by hand) */
    seedRemote(spec: TreeSpec): this {
        writeTree(this.remoteSiteDir, spec);
        return this;
    }

    removeRemote(relativePath: string): this {
        fs.rmSync(path.join(this.remoteSiteDir, relativePath), { recursive: true, force: true });
        return this;
    }

    readRemoteFile(relativePath: string): string {
        return fs.readFileSync(path.join(this.remoteSiteDir, relativePath), "utf8");
    }

    remoteExists(relativePath: string): boolean {
        return fs.existsSync(path.join(this.remoteSiteDir, relativePath));
    }

    /** the sync-state file as stored on the server, or undefined when absent */
    readRemoteState(stateName = DEFAULT_STATE_NAME): any | undefined {
        const file = path.join(this.remoteSiteDir, stateName);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
    }

    writeRemoteState(content: string | object, stateName = DEFAULT_STATE_NAME): this {
        writeTree(this.remoteSiteDir, { [stateName]: typeof content === "string" ? content : JSON.stringify(content) });
        return this;
    }

    // ---- snapshots / assertions -----------------------------------------------------------

    localTree(): FlatTree {
        return sortTree(readTree(this.localDir, rel => rel === DEFAULT_STATE_NAME));
    }

    remoteTree(stateName = DEFAULT_STATE_NAME): FlatTree {
        return sortTree(readTree(this.remoteSiteDir, rel => rel === stateName));
    }

    /**
     * What the remote should look like after a deploy: the local tree minus anything the exclude filters hide.
     * (uses the library's own filter, tests that care about exclude semantics should pass an explicit expectation instead)
     */
    expectedRemoteFromLocal(exclude: string[] = getDefaultSettings({ server: "", username: "", password: "" }).exclude): FlatTree {
        const filtered: FlatTree = {};
        for (const [rel, content] of Object.entries(this.localTree())) {
            const included = applyExcludeFilter({ path: rel, isDirectory: () => content === null }, exclude);
            if (included) { filtered[rel] = content; }
        }
        return filtered;
    }

    /** Asserts the remote is exactly this tree (state file excluded). Failure messages list every missing / extra / different path. */
    expectRemote(expected: TreeSpec, stateName = DEFAULT_STATE_NAME): void {
        this.expectRemoteFlat(flattenSpec(expected), stateName);
    }

    expectRemoteFlat(expected: FlatTree, stateName = DEFAULT_STATE_NAME): void {
        const problems = diffTrees(this.remoteTree(stateName), expected);
        if (problems.length > 0) {
            throw new Error("Remote does not match expectation:\n  " + problems.join("\n  "));
        }
    }

    expectRemoteInSync(exclude?: string[], stateName = DEFAULT_STATE_NAME): void {
        this.expectRemoteFlat(this.expectedRemoteFromLocal(exclude), stateName);
    }

    // ---- running ----------------------------------------------------------------------------

    /** runs ftp-deploy against the test server. Never throws, inspect `.error` / call `.expectOk()` */
    async deploy(overrides: Partial<IFtpDeployArguments> = {}): Promise<DeployRun> {
        const args = getDefaultSettings({
            server: "127.0.0.1",
            username: "tester",
            password: "secret",
            port: this.server.port,
            protocol: this.server.protocol,
            "local-dir": this.localDir,
            "log-level": "standard",
            timeout: 5000,
            ...overrides,
        });

        const logger = new CapturingLogger();
        const commandsBefore = this.server.commands.length;
        let error: unknown;

        try {
            await deploy(args, logger, new Timings());
        }
        catch (e) {
            error = e ?? new Error("deploy threw a falsy value");
        }

        return new DeployRun(error, logger, this.server.commands.slice(commandsBefore));
    }
}
