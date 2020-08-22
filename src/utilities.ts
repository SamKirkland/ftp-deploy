import prettyMilliseconds from "pretty-ms";

export interface ILogger {
    all(...data: any[]): void;
    warn(...data: any[]): void;
    info(...data: any[]): void;
    debug(...data: any[]): void;
}

export class Logger implements ILogger {
    constructor(level: "warn" | "info" | "debug") {
        this.level = level ?? "info";
    }

    private level: "warn" | "info" | "debug";

    public all(...data: any[]): void {
        console.log(...data);
    }

    public warn(...data: any[]): void {
        if (this.level === "debug") { return; }

        console.log(...data);
    }

    public info(...data: any[]): void {
        if (this.level === "warn") { return; }

        console.log(...data);
    }

    public debug(...data: any[]): void {
        if (this.level !== "debug") { return; }

        console.log(...data);
    }
}

export function pluralize(count: number, singular: string, plural: string) {
    if (count === 1) {
        return singular;
    }

    return plural;
}

interface ITimers {
    [key: string]: Timer | undefined;
}

type AvailableTimers = "connecting" | "hash" | "upload" | "total";

export class Timings {
    private timers: ITimers = {};

    public start(type: AvailableTimers): void {
        this.timers[type] = new Timer();
        this.timers[type]!.start();
    }

    public end(type: AvailableTimers): void {
        this.timers[type]!.end();
    }

    public getTime(type: AvailableTimers): number {
        const timer = this.timers[type];
        if (timer === undefined || timer.time === null) {
            return 0;
        }

        return timer.time;
    }

    public getTimeFormatted(type: AvailableTimers): string {
        const timer = this.timers[type];
        if (timer === undefined || timer.time === null) {
            return "💣 Failed";
        }

        return prettyMilliseconds(timer.time, { verbose: true });
    }
}

export class Timer {
    private startTime: number | null = null;
    private endTime: number | null = null;

    start() {
        this.startTime = new Date().getTime();
    }

    end() {
        this.endTime = new Date().getTime();
    }

    get time() {
        if (this.startTime === null || this.endTime === null) {
            return null;
        }

        return this.endTime - this.startTime;
    }
}