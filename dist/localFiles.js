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
exports.getLocalFiles = void 0;
const readdir_enhanced_1 = __importDefault(require("@jsdevtools/readdir-enhanced"));
const types_1 = require("./types");
const HashDiff_1 = require("./HashDiff");
const utilities_1 = require("./utilities");
function getLocalFiles(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const files = yield readdir_enhanced_1.default.async(args["local-dir"], { deep: true, stats: true, sep: "/", filter: (stat) => utilities_1.applyExcludeFilter(stat, args.exclude) });
        const records = [];
        for (let stat of files) {
            if (stat.isDirectory()) {
                records.push({
                    type: "folder",
                    name: stat.path,
                    size: undefined
                });
                continue;
            }
            if (stat.isFile()) {
                records.push({
                    type: "file",
                    name: stat.path,
                    size: stat.size,
                    hash: yield HashDiff_1.fileHash(args["local-dir"] + stat.path, "sha256")
                });
                continue;
            }
            if (stat.isSymbolicLink()) {
                console.warn("This script is currently unable to handle symbolic links - please add a feature request if you need this");
            }
        }
        return {
            description: types_1.syncFileDescription,
            version: types_1.currentSyncFileVersion,
            generatedTime: new Date().getTime(),
            data: records
        };
    });
}
exports.getLocalFiles = getLocalFiles;
