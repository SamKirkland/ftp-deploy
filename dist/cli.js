#! /usr/bin/env node
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
const module_1 = require("./module");
const yargs_1 = __importDefault(require("yargs"));
const argv = yargs_1.default.options({
    "server": { type: "string", demandOption: true },
    "username": { type: "string", demandOption: true },
    "password": { type: "string", demandOption: true },
    "port": { type: "number", default: 21 },
    "local-dir": { type: "string", default: "./" },
    "server-dir": { type: "string", default: "./" },
    "state-name": { type: "string", default: ".ftp-deploy-sync-state.json" },
    "dry-run": { type: "boolean", default: false, description: "Prints which modifications will be made with current config options, but doesn't actually make any changes" },
    "dangerous-clean-slate": { type: "boolean", default: false, description: "Deletes ALL contents of server-dir, even items in excluded with 'exclude' argument" },
    "sync-posix-modes": { type: "boolean", default: false, description: "Sync POSIX file modes to server for new files. (Note: Only supported on POSIX compatible FTP servers.)" },
    "exclude": { type: "array", default: module_1.excludeDefaults, description: "An array of glob patterns, these files will not be included in the publish/delete process" },
    "log-level": { choices: ["minimal", "standard", "verbose"], default: "standard", description: "How much information should print. minimal=only important info, standard=important info and basic file changes, verbose=print everything the script is doing" },
    "security": { choices: ["strict", "loose"], default: "loose", description: "" }
})
    .example("$0 --server ftp://samkirkland.com --username user --password pass", "")
    .help("help")
    .epilog("Read more at https://github.com/SamKirkland/FTP-Deploy-Action")
    .argv;
function runScript() {
    return __awaiter(this, void 0, void 0, function* () {
        yield module_1.deploy(argv);
    });
}
runScript();
