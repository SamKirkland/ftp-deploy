import FtpSrv, { FileSystem } from "ftp-srv";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

const fixtures = path.join(__dirname, "../fixtures");

export type FaultAction =
    /** answer with this reply code instead of running the command, e.g. { reply: 550 } */
    | { type: "reply"; code: number; message?: string }
    /** destroy the control connection without answering (server crash / network drop) */
    | { type: "drop" }
    /** wait before running the command normally (slow server) */
    | { type: "delay"; ms: number }
    /** never answer (client should hit its timeout) */
    | { type: "hang" }
    /** only valid for STOR: accept the upload, then kill the connection after N bytes (leaves a partial file) */
    | { type: "dropDuringUpload"; afterBytes: number };

export interface FaultRule {
    /** FTP verb, e.g. "STOR", or a regexp tested against the raw command line, e.g. /^DELE .*\.html$/ */
    match: string | RegExp;
    action: FaultAction;
    /** how many matching commands to ignore before the rule starts firing. @default 0 */
    skip?: number;
    /** how many times the rule fires. @default Infinity */
    times?: number;
}

export interface CommandRecord {
    directive: string;
    arg: string | null;
    raw: string;
    connectionId: string;
    /** the kind of fault that intercepted this command, if any */
    fault?: FaultAction["type"];
}

export interface TestServerOptions {
    /** directory exposed as the ftp root */
    root: string;
    /** directory (relative to root, starting with "/") the user lands in after login. @default "/" */
    home?: string;
    /** when omitted anonymous login is allowed and any credentials are accepted */
    credentials?: { username: string; password: string };
    /** "explicit" = AUTH TLS (protocol "ftps"), "implicit" = ftps:// from the first byte (protocol "ftps-legacy") */
    tls?: "explicit" | "implicit";
    /** FTP verbs the server pretends not to support (answers 502) */
    disabledCommands?: string[];
    /** writes (STOR, DELE, MKD, RMD, RNFR, RNTO) are answered with "550 Permission denied" */
    readOnly?: boolean;
    /** artificial latency added to every command */
    latencyMs?: number;
    rules?: FaultRule[];
}

const WRITE_VERBS = ["STOR", "STOU", "APPE", "DELE", "MKD", "XMKD", "RMD", "XRMD", "RNFR", "RNTO"];

interface ActiveRule extends FaultRule {
    seen: number;
    fired: number;
}

/**
 * A real FTP server (ftp-srv) running on a random local port, serving a real directory.
 * Every command is recorded and any command can be made to fail/slow down/drop, which lets tests
 * recreate server behaviours that are hard to reproduce against a real host.
 */
export class TestFtpServer {
    readonly commands: CommandRecord[] = [];
    private rules: ActiveRule[] = [];
    private server!: any;
    private _port = 0;
    /** connection id => bytes allowed before the next upload on that connection is killed */
    private uploadBudgets = new Map<string, number>();

    constructor(readonly options: TestServerOptions) {
        this.rules = (options.rules ?? []).map(rule => ({ ...rule, seen: 0, fired: 0 }));
    }

    get port(): number { return this._port; }
    get root(): string { return this.options.root; }

    /** value to pass as `protocol` to ftp-deploy */
    get protocol(): "ftp" | "ftps" | "ftps-legacy" {
        if (this.options.tls === "explicit") { return "ftps"; }
        if (this.options.tls === "implicit") { return "ftps-legacy"; }
        return "ftp";
    }

    async start(): Promise<this> {
        const { options } = this;
        const tls = options.tls === undefined ? false : {
            key: fs.readFileSync(path.join(fixtures, "test-key.pem")),
            cert: fs.readFileSync(path.join(fixtures, "test-cert.pem")),
        };

        // random passive range so parallel jest workers don't fight over ports
        const pasvMin = 20000 + Math.floor(Math.random() * 40000);

        this.server = new (FtpSrv as any)({
            url: `${options.tls === "implicit" ? "ftps" : "ftp"}://127.0.0.1:0`,
            anonymous: options.credentials === undefined,
            pasv_url: "127.0.0.1",
            pasv_min: pasvMin,
            pasv_max: pasvMin + 500,
            tls,
            blacklist: options.disabledCommands ?? [],
            log: silentLogger,
        } as any);

        this.server.on("connect", ({ connection }: any) => this.instrumentConnection(connection));

        this.server.on("login", ({ username, password, connection }: any, resolve: Function, reject: Function) => {
            const creds = options.credentials;
            if (creds !== undefined && (username !== creds.username || password !== creds.password)) {
                return reject(Object.assign(new Error("Authentication failed"), { code: 530 }));
            }

            resolve({ fs: new BudgetedFileSystem(connection, { root: options.root, cwd: options.home }, this.uploadBudgets) });
        });

        await this.server.listen();
        this._port = (this.server.server.address() as AddressInfo).port;
        return this;
    }

    async stop(): Promise<void> {
        // connections left open by hang/drop faults would keep close() waiting (and jest alive) forever
        for (const connection of Object.values<any>(this.server.connections ?? {})) {
            connection.commandSocket?.destroy();
            connection.connector?.socket?.destroy();
        }

        await Promise.race([this.server.close(), sleep(2000)]);
    }

    // ---- fault configuration -------------------------------------------------------------

    addRule(rule: FaultRule): this {
        this.rules.push({ ...rule, seen: 0, fired: 0 });
        return this;
    }

    clearRules(): this {
        this.rules = [];
        return this;
    }

    /** shorthand: respond to matching commands with an error code */
    failWith(match: FaultRule["match"], code: number, extra: Pick<FaultRule, "skip" | "times"> = {}): this {
        return this.addRule({ match, action: { type: "reply", code }, ...extra });
    }

    // ---- observation -------------------------------------------------------------------

    /** forget everything recorded so far (call between deploys when asserting on a single deploy) */
    resetCommandLog(): void {
        this.commands.length = 0;
    }

    commandsOf(...directives: string[]): CommandRecord[] {
        return this.commands.filter(c => directives.includes(c.directive));
    }

    /** paths passed to STOR (as sent by the client), in order */
    uploads(): string[] {
        return this.commandsOf("STOR").map(c => c.arg ?? "");
    }

    deletes(): string[] {
        return this.commandsOf("DELE").map(c => c.arg ?? "");
    }

    removedDirs(): string[] {
        return this.commandsOf("RMD", "XRMD").map(c => c.arg ?? "");
    }

    madeDirs(): string[] {
        return this.commandsOf("MKD", "XMKD").map(c => c.arg ?? "");
    }

    /** number of distinct control connections seen (reconnect detection) */
    connectionCount(): number {
        return new Set(this.commands.map(c => c.connectionId)).size;
    }

    // ---- internals ---------------------------------------------------------------------

    private findRule(raw: string, directive: string): ActiveRule | undefined {
        for (const rule of this.rules) {
            const matches = typeof rule.match === "string" ? rule.match.toUpperCase() === directive : rule.match.test(raw);
            if (!matches) { continue; }

            rule.seen++;
            if (rule.seen <= (rule.skip ?? 0)) { continue; }
            if (rule.fired >= (rule.times ?? Infinity)) { continue; }

            rule.fired++;
            return rule;
        }

        return undefined;
    }

    private instrumentConnection(connection: any) {
        const commands = connection.commands;
        const originalHandle = commands.handle.bind(commands);

        commands.handle = async (message: string | { raw: string }) => {
            const raw = typeof message === "string" ? message : message.raw;
            const parsed = commands.parse(raw);
            const record: CommandRecord = {
                directive: parsed.directive,
                arg: parsed.directive === "PASS" ? "********" : parsed.arg,
                raw: parsed.directive === "PASS" ? "PASS ********" : raw,
                connectionId: connection.id,
            };
            this.commands.push(record);

            if (this.options.latencyMs) {
                await sleep(this.options.latencyMs);
            }

            if (this.options.readOnly && WRITE_VERBS.includes(parsed.directive)) {
                record.fault = "reply";
                return connection.reply(550, "Permission denied");
            }

            const rule = this.findRule(raw, parsed.directive);
            if (rule !== undefined) {
                record.fault = rule.action.type;

                switch (rule.action.type) {
                    case "reply":
                        return connection.reply(rule.action.code, rule.action.message ?? "Injected failure");
                    case "drop":
                        connection.commandSocket.destroy();
                        return;
                    case "hang":
                        return new Promise<void>(() => { /* never resolves */ });
                    case "delay":
                        await sleep(rule.action.ms);
                        break;
                    case "dropDuringUpload":
                        this.uploadBudgets.set(connection.id, rule.action.afterBytes);
                        break;
                }
            }

            return originalHandle(message);
        };
    }
}

const silentLogger: any = {
    trace() { }, debug() { }, info() { }, warn() { }, error() { }, fatal() { },
    child() { return silentLogger; },
};

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/** ftp-srv file system that can kill the connection part way through an upload */
class BudgetedFileSystem extends FileSystem {
    private conn: any;
    private budgets: Map<string, number>;

    constructor(connection: any, opts: { root: string; cwd?: string }, budgets: Map<string, number>) {
        super(connection, opts as any);
        this.conn = connection;
        this.budgets = budgets;
    }

    write(fileName: string, options?: { append?: boolean; start?: number }): any {
        const result: any = super.write(fileName, options as any);
        const budget = this.budgets.get(this.conn.id);

        if (budget === undefined) {
            return result;
        }

        this.budgets.delete(this.conn.id);
        const stream = result.stream;
        const originalWrite = stream.write.bind(stream);
        let written = 0;

        stream.write = (chunk: Buffer, ...rest: any[]) => {
            const remaining = budget - written;
            if (remaining <= chunk.length) {
                // flush the allowed part so a partial file is left behind, then yank the cables
                originalWrite(chunk.subarray(0, Math.max(remaining, 0)), () => {
                    this.conn.commandSocket.destroy();
                    this.conn.connector?.socket?.destroy();
                    stream.destroy();
                });
                written = budget;
                return false;
            }

            written += chunk.length;
            return originalWrite(chunk, ...rest);
        };

        return result;
    }
}
