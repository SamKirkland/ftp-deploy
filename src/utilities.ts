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

type AvailableTimers = "connecting" | "hash" | "upload" | "total" | "changingDir";

export class Timings {
    private timers: ITimers = {};

    public start(type: AvailableTimers): void {
        if (this.timers[type] === undefined) {
            this.timers[type] = new Timer();
        }

        this.timers[type]!.start();
    }

    public stop(type: AvailableTimers): void {
        this.timers[type]!.stop();
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

/**
 * first number is seconds
 * second number is nanoseconds
 */
type HRTime = [number, number];

export class Timer {
    private totalTime: HRTime | null = null;
    private startTime: HRTime | null = null;
    private endTime: HRTime | null = null;

    start() {
        this.startTime = process.hrtime();
    }

    stop() {
        if (this.startTime === null) {
            throw new Error("Called .stop() before calling .start()");
        }

        this.endTime = process.hrtime(this.startTime);

        const currentSeconds = this.totalTime === null ? 0 : this.totalTime[0];
        const currentNS = this.totalTime === null ? 0 : this.totalTime[1];

        this.totalTime = [
            currentSeconds + this.endTime[0],
            currentNS + this.endTime[1]
        ];
    }

    get time() {
        if (this.totalTime === null) {
            return null;
        }

        return (this.totalTime[0] * 1000) + (this.totalTime[1] / 1000000);
    }
}