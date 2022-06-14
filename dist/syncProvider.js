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
exports.FTPSyncProvider = exports.ensureDir = void 0;
const fs_1 = __importDefault(require("fs"));
const util_1 = __importDefault(require("util"));
const pretty_bytes_1 = __importDefault(require("pretty-bytes"));
const types_1 = require("./types");
const utilities_1 = require("./utilities");
const stat = util_1.default.promisify(fs_1.default.stat);
function ensureDir(client, logger, timings, folder) {
    return __awaiter(this, void 0, void 0, function* () {
        timings.start("changingDir");
        logger.verbose(`  changing dir to ${folder}`);
        yield utilities_1.retryRequest(logger, () => __awaiter(this, void 0, void 0, function* () { return yield client.ensureDir(folder); }));
        logger.verbose(`  dir changed`);
        timings.stop("changingDir");
    });
}
exports.ensureDir = ensureDir;
class FTPSyncProvider {
    constructor(client, logger, timings, localPath, serverPath, stateName, dryRun, syncPosixModes) {
        this.client = client;
        this.logger = logger;
        this.timings = timings;
        this.localPath = localPath;
        this.serverPath = serverPath;
        this.stateName = stateName;
        this.dryRun = dryRun;
        this.syncPosixModes = syncPosixModes;
    }
    /**
     * Converts a file path (ex: "folder/otherfolder/file.txt") to an array of folder and a file path
     * @param fullPath
     */
    getFileBreadcrumbs(fullPath) {
        var _a;
        // todo see if this regex will work for nonstandard folder names
        // todo what happens if the path is relative to the root dir? (starts with /)
        const pathSplit = fullPath.split("/");
        const file = (_a = pathSplit === null || pathSplit === void 0 ? void 0 : pathSplit.pop()) !== null && _a !== void 0 ? _a : ""; // get last item
        const folders = pathSplit.filter(folderName => folderName != "");
        return {
            folders: folders.length === 0 ? null : folders,
            file: file === "" ? null : file
        };
    }
    /**
     * Navigates up {dirCount} number of directories from the current working dir
     */
    upDir(dirCount) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof dirCount !== "number") {
                return;
            }
            // navigate back to the starting folder
            for (let i = 0; i < dirCount; i++) {
                yield utilities_1.retryRequest(this.logger, () => __awaiter(this, void 0, void 0, function* () { return yield this.client.cdup(); }));
            }
        });
    }
    createFolder(folderPath) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.all(`creating folder "${folderPath + "/"}"`);
            if (this.dryRun === true) {
                return;
            }
            const path = this.getFileBreadcrumbs(folderPath + "/");
            if (path.folders === null) {
                this.logger.verbose(`  no need to change dir`);
            }
            else {
                yield ensureDir(this.client, this.logger, this.timings, path.folders.join("/"));
            }
            // navigate back to the root folder
            yield this.upDir((_a = path.folders) === null || _a === void 0 ? void 0 : _a.length);
            this.logger.verbose(`  completed`);
        });
    }
    removeFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.all(`removing "${filePath}"`);
            if (this.dryRun === false) {
                try {
                    yield utilities_1.retryRequest(this.logger, () => __awaiter(this, void 0, void 0, function* () { return yield this.client.remove(filePath); }));
                }
                catch (e) {
                    // this error is common when a file was deleted on the server directly
                    if (e.code === types_1.ErrorCode.FileNotFoundOrNoAccess) {
                        this.logger.standard("File not found or you don't have access to the file - skipping...");
                    }
                    else {
                        throw e;
                    }
                }
            }
            this.logger.verbose(`  file removed`);
            this.logger.verbose(`  completed`);
        });
    }
    removeFolder(folderPath) {
        return __awaiter(this, void 0, void 0, function* () {
            const absoluteFolderPath = "/" + (this.serverPath.startsWith("./") ? this.serverPath.replace("./", "") : this.serverPath) + folderPath;
            this.logger.all(`removing folder "${absoluteFolderPath}"`);
            if (this.dryRun === false) {
                yield utilities_1.retryRequest(this.logger, () => __awaiter(this, void 0, void 0, function* () { return yield this.client.removeDir(absoluteFolderPath); }));
            }
            this.logger.verbose(`  completed`);
        });
    }
    uploadFile(filePath, type = "upload") {
        return __awaiter(this, void 0, void 0, function* () {
            const typePresent = type === "upload" ? "uploading" : "replacing";
            const typePast = type === "upload" ? "uploaded" : "replaced";
            this.logger.all(`${typePresent} "${filePath}"`);
            if (this.dryRun === false) {
                yield utilities_1.retryRequest(this.logger, () => __awaiter(this, void 0, void 0, function* () { return yield this.client.uploadFrom(this.localPath + filePath, filePath); }));
            }
            this.logger.verbose(`  file ${typePast}`);
        });
    }
    syncMode(file) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.syncPosixModes) {
                return;
            }
            this.logger.verbose("Syncing posix mode for file " + file.name);
            // https://www.martin-brennan.com/nodejs-file-permissions-fstat/
            let stats = yield stat(this.localPath + file.name);
            let mode = "0" + (stats.mode & parseInt('777', 8)).toString(8);
            // https://github.com/patrickjuchli/basic-ftp/issues/9
            let command = "SITE CHMOD " + mode + " " + file.name;
            if (this.dryRun === false) {
                yield this.client.ftp.request(command);
            }
            this.logger.verbose("Setting file mode with command " + command);
        });
    }
    syncLocalToServer(diffs) {
        return __awaiter(this, void 0, void 0, function* () {
            const totalCount = diffs.delete.length + diffs.upload.length + diffs.replace.length;
            this.logger.all(`----------------------------------------------------------------`);
            this.logger.all(`Making changes to ${totalCount} ${utilities_1.pluralize(totalCount, "file/folder", "files/folders")} to sync server state`);
            this.logger.all(`Uploading: ${pretty_bytes_1.default(diffs.sizeUpload)} -- Deleting: ${pretty_bytes_1.default(diffs.sizeDelete)} -- Replacing: ${pretty_bytes_1.default(diffs.sizeReplace)}`);
            this.logger.all(`----------------------------------------------------------------`);
            // create new folders
            for (const file of diffs.upload.filter(item => item.type === "folder")) {
                yield this.createFolder(file.name);
                yield this.syncMode(file);
            }
            // upload new files
            for (const file of diffs.upload.filter(item => item.type === "file").filter(item => item.name !== this.stateName)) {
                yield this.uploadFile(file.name, "upload");
                yield this.syncMode(file);
            }
            // replace new files
            for (const file of diffs.replace.filter(item => item.type === "file").filter(item => item.name !== this.stateName)) {
                // note: FTP will replace old files with new files. We run replacements after uploads to limit downtime
                yield this.uploadFile(file.name, "replace");
                yield this.syncMode(file);
            }
            // delete old files
            for (const file of diffs.delete.filter(item => item.type === "file")) {
                yield this.removeFile(file.name);
            }
            // delete old folders
            for (const file of diffs.delete.filter(item => item.type === "folder")) {
                yield this.removeFolder(file.name);
            }
            this.logger.all(`----------------------------------------------------------------`);
            this.logger.all(`🎉 Sync complete. Saving current server state to "${this.serverPath + this.stateName}"`);
            if (this.dryRun === false) {
                yield utilities_1.retryRequest(this.logger, () => __awaiter(this, void 0, void 0, function* () { return yield this.client.uploadFrom(this.localPath + this.stateName, this.stateName); }));
            }
        });
    }
}
exports.FTPSyncProvider = FTPSyncProvider;
