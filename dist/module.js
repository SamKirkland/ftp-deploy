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
Object.defineProperty(exports, "__esModule", { value: true });
exports.deploy = exports.excludeDefaults = void 0;
const deploy_1 = require("./deploy");
const utilities_1 = require("./utilities");
/**
 * Default excludes, ignores all git files and the node_modules folder
 * **\/.git* ignores all FILES that start with .git(in any folder or sub-folder)
 * **\/.git*\/** ignores all FOLDERS that start with .git (in any folder or sub-folder)
 * **\/node_modules\/** ignores all FOLDERS named node_modules (in any folder or sub-folder)
 */
exports.excludeDefaults = ["**/.git*", "**/.git*/**", "**/node_modules/**"];
/**
 * Syncs a local folder with a remote folder over FTP.
 * After the initial sync only differences are synced, making deployments super fast!
 */
function deploy(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const argsWithDefaults = utilities_1.getDefaultSettings(args);
        const logger = new utilities_1.Logger(argsWithDefaults["log-level"]);
        const timings = new utilities_1.Timings();
        yield deploy_1.deploy(argsWithDefaults, logger, timings);
    });
}
exports.deploy = deploy;
