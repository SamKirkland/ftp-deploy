"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Timer = exports.Timings = exports.pluralize = exports.Logger = void 0;
const pretty_ms_1 = __importDefault(require("pretty-ms"));
class Logger {
    constructor(level) {
        this.level = level !== null && level !== void 0 ? level : "info";
    }
    all(...data) {
        console.log(...data);
    }
    warn(...data) {
        if (this.level === "debug") {
            return;
        }
        console.log(...data);
    }
    info(...data) {
        if (this.level === "warn") {
            return;
        }
        console.log(...data);
    }
    debug(...data) {
        if (this.level !== "debug") {
            return;
        }
        console.log(...data);
    }
}
exports.Logger = Logger;
function pluralize(count, singular, plural) {
    if (count === 1) {
        return singular;
    }
    return plural;
}
exports.pluralize = pluralize;
class Timings {
    constructor() {
        this.timers = {};
    }
    start(type) {
        this.timers[type] = new Timer();
        this.timers[type].start();
    }
    end(type) {
        this.timers[type].end();
    }
    getTime(type) {
        const timer = this.timers[type];
        if (timer === undefined || timer.time === null) {
            return 0;
        }
        return timer.time;
    }
    getTimeFormatted(type) {
        const timer = this.timers[type];
        if (timer === undefined || timer.time === null) {
            return "💣 Failed";
        }
        return pretty_ms_1.default(timer.time, { verbose: true });
    }
}
exports.Timings = Timings;
class Timer {
    constructor() {
        this.startTime = null;
        this.endTime = null;
    }
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
exports.Timer = Timer;
