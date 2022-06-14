"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.deploy = void 0;
const ftp = __importStar(require("basic-ftp"));
const fs_1 = __importDefault(require("fs"));
const types_1 = require("./types");
const HashDiff_1 = require("./HashDiff");
const utilities_1 = require("./utilities");
const pretty_bytes_1 = __importDefault(require("pretty-bytes"));
const errorHandling_1 = require("./errorHandling");
const syncProvider_1 = require("./syncProvider");
const localFiles_1 = require("./localFiles");
function downloadFileList(client, logger, path) {
    return __awaiter(this, void 0, void 0, function* () {
        // note: originally this was using a writable stream instead of a buffer file
        // basic-ftp doesn't seam to close the connection when using steams over some ftps connections. This appears to be dependent on the ftp server
        const tempFileNameHack = ".ftp-deploy-sync-server-state-buffer-file---delete.json";
        yield utilities_1.retryRequest(logger, () => __awaiter(this, void 0, void 0, function* () { return yield client.downloadTo(tempFileNameHack, path); }));
        const fileAsString = fs_1.default.readFileSync(tempFileNameHack, { encoding: "utf-8" });
        const fileAsObject = JSON.parse(fileAsString);
        fs_1.default.unlinkSync(tempFileNameHack);
        return fileAsObject;
    });
}
function createLocalState(localFiles, logger, args) {
    logger.verbose(`Creating local state at ${args["local-dir"]}${args["state-name"]}`);
    fs_1.default.writeFileSync(`${args["local-dir"]}${args["state-name"]}`, JSON.stringify(localFiles, undefined, 4), { encoding: "utf8" });
    logger.verbose("Local state created");
}
function connect(client, args, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        let secure = false;
        if (args.protocol === "ftps") {
            secure = true;
        }
        else if (args.protocol === "ftps-legacy") {
            secure = "implicit";
        }
        client.ftp.verbose = args["log-level"] === "verbose";
        const rejectUnauthorized = args.security === "strict";
        try {
            yield client.access({
                host: args.server,
                user: args.username,
                password: args.password,
                port: args.port,
                secure: secure,
                secureOptions: {
                    rejectUnauthorized: rejectUnauthorized
                }
            });
        }
        catch (error) {
            logger.all("Failed to connect, are you sure your server works via FTP or FTPS? Users sometimes get this error when the server only supports SFTP.");
            throw error;
        }
        if (args["log-level"] === "verbose") {
            client.trackProgress(info => {
                logger.verbose(`${info.type} progress for "${info.name}". Progress: ${info.bytes} bytes of ${info.bytesOverall} bytes`);
            });
        }
    });
}
function getServerFiles(client, logger, timings, args) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield syncProvider_1.ensureDir(client, logger, timings, args["server-dir"]);
            if (args["dangerous-clean-slate"]) {
                logger.all(`----------------------------------------------------------------`);
                logger.all("🗑️ Removing all files on the server because 'dangerous-clean-slate' was set, this will make the deployment very slow...");
                yield client.clearWorkingDir();
                logger.all("Clear complete");
                throw new Error("nope");
            }
            const serverFiles = yield downloadFileList(client, logger, args["state-name"]);
            logger.all(`----------------------------------------------------------------`);
            logger.all(`Last published on 📅 ${new Date(serverFiles.generatedTime).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric" })}`);
            // apply exclude options to server
            if (args.exclude.length > 0) {
                const filteredData = serverFiles.data.filter((item) => utilities_1.applyExcludeFilter({ path: item.name, isDirectory: () => item.type === "folder" }, args.exclude));
                serverFiles.data = filteredData;
            }
            return serverFiles;
        }
        catch (error) {
            logger.all(`----------------------------------------------------------------`);
            logger.all(`No file exists on the server "${args["server-dir"] + args["state-name"]}" - this must be your first publish! 🎉`);
            logger.all(`The first publish will take a while... but once the initial sync is done only differences are published!`);
            logger.all(`If you get this message and its NOT your first publish, something is wrong.`);
            // set the server state to nothing, because we don't know what the server state is
            return {
                description: types_1.syncFileDescription,
                version: types_1.currentSyncFileVersion,
                generatedTime: new Date().getTime(),
                data: [],
            };
        }
    });
}
function deploy(args, logger, timings) {
    return __awaiter(this, void 0, void 0, function* () {
        timings.start("total");
        // header
        logger.all(`----------------------------------------------------------------`);
        logger.all(`🚀 Thanks for using ftp-deploy. Let's deploy some stuff (with posix file mode support)!   `);
        logger.all(`----------------------------------------------------------------`);
        logger.all(`If you found this project helpful, please support it`);
        logger.all(`by giving it a ⭐ on Github --> https://github.com/SamKirkland/FTP-Deploy-Action`);
        logger.all(`or add a badge 🏷️ to your projects readme --> https://github.com/SamKirkland/FTP-Deploy-Action#badge`);
        logger.verbose(`Using the following excludes filters: ${JSON.stringify(args.exclude)}`);
        timings.start("hash");
        const localFiles = yield localFiles_1.getLocalFiles(args);
        timings.stop("hash");
        createLocalState(localFiles, logger, args);
        const client = new ftp.Client();
        global.reconnect = function () {
            return __awaiter(this, void 0, void 0, function* () {
                timings.start("connecting");
                yield connect(client, args, logger);
                timings.stop("connecting");
            });
        };
        let totalBytesUploaded = 0;
        try {
            yield global.reconnect();
            const serverFiles = yield getServerFiles(client, logger, timings, args);
            timings.start("logging");
            const diffTool = new HashDiff_1.HashDiff();
            logger.standard(`----------------------------------------------------------------`);
            logger.standard(`Local Files:\t${utilities_1.formatNumber(localFiles.data.length)}`);
            logger.standard(`Server Files:\t${utilities_1.formatNumber(serverFiles.data.length)}`);
            logger.standard(`----------------------------------------------------------------`);
            logger.standard(`Calculating differences between client & server`);
            logger.standard(`----------------------------------------------------------------`);
            const diffs = diffTool.getDiffs(localFiles, serverFiles);
            diffs.upload.filter((itemUpload) => itemUpload.type === "folder").map((itemUpload) => {
                logger.standard(`📁 Create: ${itemUpload.name}`);
            });
            diffs.upload.filter((itemUpload) => itemUpload.type === "file").map((itemUpload) => {
                logger.standard(`📄 Upload: ${itemUpload.name}`);
            });
            diffs.replace.map((itemReplace) => {
                logger.standard(`🔁 File replace: ${itemReplace.name}`);
            });
            diffs.delete.filter((itemUpload) => itemUpload.type === "file").map((itemDelete) => {
                logger.standard(`📄 Delete: ${itemDelete.name}    `);
            });
            diffs.delete.filter((itemUpload) => itemUpload.type === "folder").map((itemDelete) => {
                logger.standard(`📁 Delete: ${itemDelete.name}    `);
            });
            diffs.same.map((itemSame) => {
                if (itemSame.type === "file") {
                    logger.standard(`⚖️  File content is the same, doing nothing: ${itemSame.name}`);
                }
            });
            timings.stop("logging");
            totalBytesUploaded = diffs.sizeUpload + diffs.sizeReplace;
            timings.start("upload");
            try {
                const syncProvider = new syncProvider_1.FTPSyncProvider(client, logger, timings, args["local-dir"], args["server-dir"], args["state-name"], args["dry-run"], args["sync-posix-modes"]);
                yield syncProvider.syncLocalToServer(diffs);
            }
            finally {
                timings.stop("upload");
            }
        }
        catch (error) {
            errorHandling_1.prettyError(logger, args, error);
            throw error;
        }
        finally {
            client.close();
            timings.stop("total");
        }
        const uploadSpeed = pretty_bytes_1.default(totalBytesUploaded / (timings.getTime("upload") / 1000));
        // footer
        logger.all(`----------------------------------------------------------------`);
        logger.all(`Time spent hashing: ${timings.getTimeFormatted("hash")}`);
        logger.all(`Time spent connecting to server: ${timings.getTimeFormatted("connecting")}`);
        logger.all(`Time spent deploying: ${timings.getTimeFormatted("upload")} (${uploadSpeed}/second)`);
        logger.all(`  - changing dirs: ${timings.getTimeFormatted("changingDir")}`);
        logger.all(`  - logging: ${timings.getTimeFormatted("logging")}`);
        logger.all(`----------------------------------------------------------------`);
        logger.all(`Total time: ${timings.getTimeFormatted("total")}`);
        logger.all(`----------------------------------------------------------------`);
    });
}
exports.deploy = deploy;
