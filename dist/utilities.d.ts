import { IFtpDeployArguments, IFtpDeployArgumentsWithDefaults } from "./types";
export interface ILogger {
    all(...data: any[]): void;
    standard(...data: any[]): void;
    verbose(...data: any[]): void;
}
export declare class Logger implements ILogger {
    constructor(level: "minimal" | "standard" | "verbose");
    private level;
    all(...data: any[]): void;
    standard(...data: any[]): void;
    verbose(...data: any[]): void;
}
export declare function pluralize(count: number, singular: string, plural: string): string;
export declare function formatNumber(number: number): string;
/**
 * retry a request
 *
 * @example retryRequest(logger, async () => await item());
 */
export declare function retryRequest<T>(logger: ILogger, callback: () => Promise<T>): Promise<T>;
declare type AvailableTimers = "connecting" | "hash" | "upload" | "total" | "changingDir" | "logging";
export interface ITimings {
    start(type: AvailableTimers): void;
    stop(type: AvailableTimers): void;
    getTime(type: AvailableTimers): number;
    getTimeFormatted(type: AvailableTimers): string;
}
export declare class Timings implements ITimings {
    private timers;
    start(type: AvailableTimers): void;
    stop(type: AvailableTimers): void;
    getTime(type: AvailableTimers): number;
    getTimeFormatted(type: AvailableTimers): string;
}
export declare class Timer {
    private totalTime;
    private startTime;
    private endTime;
    start(): void;
    stop(): void;
    get time(): number | null;
}
export declare function getDefaultSettings(withoutDefaults: IFtpDeployArguments): IFtpDeployArgumentsWithDefaults;
interface IStats {
    path: string;
    isDirectory(): boolean;
}
export declare function applyExcludeFilter(stat: IStats, excludeFilters: Readonly<string[]>): boolean;
export {};
