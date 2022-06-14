"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyExcludeFilter = exports.getDefaultSettings = exports.Timer = exports.Timings = exports.retryRequest = exports.formatNumber = exports.pluralize = exports.Logger = void 0;
const pretty_ms_1 = __importDefault(require("pretty-ms"));
const module_1 = require("./module");
const types_1 = require("./types");
const multimatch_1 = __importDefault(require("multimatch"));
class Logger {
    constructor(level) {
        this.level = level;
    }
    all(...data) {
        console.log(...data);
    }
    standard(...data) {
        if (this.level === "minimal") {
            return;
        }
        console.log(...data);
    }
    verbose(...data) {
        if (this.level !== "verbose") {
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
function formatNumber(number) {
    return number.toLocaleString();
}
exports.formatNumber = formatNumber;
/**
 * retry a request
 *
 * @example retryRequest(logger, async () => await item());
 */
function retryRequest(logger, callback) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield callback();
        }
        catch (e) {
            if (e.code >= 400 && e.code <= 499) {
                logger.standard("400 level error from server when performing action - retrying...");
                logger.standard(e);
                if (e.code === types_1.ErrorCode.ConnectionClosed) {
                    logger.all("Connection closed. This library does not currently handle reconnects");
                    // await global.reconnect();
                    // todo reset current working dir
                    throw e;
                }
                return yield callback();
            }
            else {
                throw e;
            }
        }
    });
}
exports.retryRequest = retryRequest;
class Timings {
    constructor() {
        this.timers = {};
    }
    start(type) {
        if (this.timers[type] === undefined) {
            this.timers[type] = new Timer();
        }
        this.timers[type].start();
    }
    stop(type) {
        this.timers[type].stop();
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
        this.totalTime = null;
        this.startTime = null;
        this.endTime = null;
    }
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
exports.Timer = Timer;
function getDefaultSettings(withoutDefaults) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    if (withoutDefaults["local-dir"] !== undefined) {
        if (!withoutDefaults["local-dir"].endsWith("/")) {
            throw new Error("local-dir should be a folder (must end with /)");
        }
    }
    if (withoutDefaults["server-dir"] !== undefined) {
        if (!withoutDefaults["server-dir"].endsWith("/")) {
            throw new Error("server-dir should be a folder (must end with /)");
        }
    }
    return {
        "server": withoutDefaults.server,
        "username": withoutDefaults.username,
        "password": withoutDefaults.password,
        "port": (_a = withoutDefaults.port) !== null && _a !== void 0 ? _a : 21,
        "protocol": (_b = withoutDefaults.protocol) !== null && _b !== void 0 ? _b : "ftp",
        "local-dir": (_c = withoutDefaults["local-dir"]) !== null && _c !== void 0 ? _c : "./",
        "server-dir": (_d = withoutDefaults["server-dir"]) !== null && _d !== void 0 ? _d : "./",
        "state-name": (_e = withoutDefaults["state-name"]) !== null && _e !== void 0 ? _e : ".ftp-deploy-sync-state.json",
        "dry-run": (_f = withoutDefaults["dry-run"]) !== null && _f !== void 0 ? _f : false,
        "dangerous-clean-slate": (_g = withoutDefaults["dangerous-clean-slate"]) !== null && _g !== void 0 ? _g : false,
        "exclude": (_h = withoutDefaults.exclude) !== null && _h !== void 0 ? _h : module_1.excludeDefaults,
        "log-level": (_j = withoutDefaults["log-level"]) !== null && _j !== void 0 ? _j : "standard",
        "security": (_k = withoutDefaults.security) !== null && _k !== void 0 ? _k : "loose",
        "sync-posix-modes": (_l = withoutDefaults["sync-posix-modes"]) !== null && _l !== void 0 ? _l : false,
    };
}
exports.getDefaultSettings = getDefaultSettings;
function applyExcludeFilter(stat, excludeFilters) {
    // match exclude, return immediatley
    if (excludeFilters.length > 0) {
        // todo this could be a performance problem...
        const pathWithFolderSlash = stat.path + (stat.isDirectory() ? "/" : "");
        const excludeMatch = multimatch_1.default(pathWithFolderSlash, excludeFilters, { matchBase: true, dot: true });
        if (excludeMatch.length > 0) {
            return false;
        }
    }
    return true;
}
exports.applyExcludeFilter = applyExcludeFilter;
