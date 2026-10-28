import * as ftp from "basic-ftp";
import fs from "fs";
import { IFileList, IDiff, syncFileDescription, currentSyncFileVersion, IFtpDeployArgumentsWithDefaults, ErrorCode } from "./types";
import { HashDiff } from "./HashDiff";
import { ILogger, retryRequest, ITimings, applyExcludeFilter, formatNumber } from "./utilities";
import prettyBytes from "pretty-bytes";
import { prettyError } from "./errorHandling";
import { ensureDir, FTPSyncProvider, remoteExists } from "./syncProvider";
import { getLocalFiles } from "./localFiles";

/**
 * Downloads the server state. Returns undefined when there is no usable state (first publish)
 */
async function downloadFileList(client: ftp.Client, logger: ILogger, path: string): Promise<IFileList | undefined> {
    // note: originally this was using a writable stream instead of a buffer file
    // basic-ftp doesn't seam to close the connection when using steams over some ftps connections. This appears to be dependent on the ftp server
    const tempFileNameHack = ".ftp-deploy-sync-server-state-buffer-file---delete.json";

    try {
        try {
            await retryRequest(logger, async () => await client.downloadTo(tempFileNameHack, path));
        }
        catch (e: any) {
            // 550 (551 on some servers) is both "no such file" and "permission denied". Treating a denied read as a first
            // publish would re-upload everything and never delete anything, so only a state file that really isn't there counts
            const maybeMissing = e?.code === ErrorCode.FileNotFoundOrNoAccess || e?.code === ErrorCode.UnknownPageType;
            if (maybeMissing && await remoteExists(client, path, "file") !== true) {
                return undefined;
            }
            throw e;
        }

        const fileAsString = fs.readFileSync(tempFileNameHack, { encoding: "utf-8" });

        let fileAsObject: any;
        try {
            fileAsObject = JSON.parse(fileAsString);
        }
        catch {
            logger.all(`The server state file "${path}" is not valid JSON, ignoring it`);
            return undefined;
        }

        if (typeof fileAsObject !== "object" || fileAsObject === null || !Array.isArray(fileAsObject.data)) {
            logger.all(`The server state file "${path}" is not in the expected format, ignoring it`);
            return undefined;
        }

        return fileAsObject as IFileList;
    }
    finally {
        if (fs.existsSync(tempFileNameHack)) {
            fs.unlinkSync(tempFileNameHack);
        }
    }
}

async function connect(client: ftp.Client, args: IFtpDeployArgumentsWithDefaults, logger: ILogger) {
    let secure: boolean | "implicit" = false;
    if (args.protocol === "ftps") {
        secure = true;
    }
    else if (args.protocol === "ftps-legacy") {
        secure = "implicit";
    }

    client.ftp.verbose = args["log-level"] === "verbose";

    const rejectUnauthorized = args.security === "strict";

    try {
        await client.access({
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

    if (secure !== false) {
        // basic-ftp sends these but ignores the reply. If the server refuses PROT P the data connections would not be
        // encrypted (or fail later with a confusing error), so stop here instead
        await client.send("PBSZ 0");
        await client.send("PROT P");
    }

    if (args["log-level"] === "verbose") {
        client.trackProgress(info => {
            logger.verbose(`${info.type} progress for "${info.name}". Progress: ${info.bytes} bytes of ${info.bytesOverall} bytes`);
        });
    }
}

function emptyFileList(): IFileList {
    return {
        description: syncFileDescription,
        version: currentSyncFileVersion,
        generatedTime: new Date().getTime(),
        data: [],
    };
}

export async function getServerFiles(client: ftp.Client, logger: ILogger, timings: ITimings, args: IFtpDeployArgumentsWithDefaults): Promise<IFileList> {
    // errors here are real problems (permissions, connection...) and must not be mistaken for a first publish
    await ensureDir(client, logger, timings, args["server-dir"]);

    if (args["dangerous-clean-slate"]) {
        logger.all(`----------------------------------------------------------------`);
        logger.all("🗑️ Removing all files on the server because 'dangerous-clean-slate' was set, this will make the deployment very slow...");
        if (args["dry-run"] === false) {
            await client.clearWorkingDir();
        }
        logger.all("Clear complete");

        // the server is empty now
        return emptyFileList();
    }

    const serverFiles = await downloadFileList(client, logger, args["state-name"]);

    if (serverFiles === undefined) {
        logger.all(`----------------------------------------------------------------`);
        logger.all(`No file exists on the server "${args["server-dir"] + args["state-name"]}" - this must be your first publish! 🎉`);
        logger.all(`The first publish will take a while... but once the initial sync is done only differences are published!`);
        logger.all(`If you get this message and its NOT your first publish, something is wrong.`);

        // set the server state to nothing, because we don't know what the server state is
        return emptyFileList();
    }

    logger.all(`----------------------------------------------------------------`);
    logger.all(`Last published on 📅 ${new Date(serverFiles.generatedTime).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric" })}`);

    // apply exclude options to server
    if (args.exclude.length > 0) {
        const filteredData = serverFiles.data.filter((item) => applyExcludeFilter({ path: item.name, isDirectory: () => item.type === "folder" }, args.exclude));
        serverFiles.data = filteredData;
    }

    return serverFiles;
}

export async function deploy(args: IFtpDeployArgumentsWithDefaults, logger: ILogger, timings: ITimings): Promise<void> {
    timings.start("total");

    // header
    logger.all(`----------------------------------------------------------------`);
    logger.all(`🚀 Thanks for using ftp-deploy. Let's deploy some stuff!   `);
    logger.all(`----------------------------------------------------------------`);
    logger.all(`If you found this project helpful, please support it`);
    logger.all(`by giving it a ⭐ on Github --> https://github.com/SamKirkland/FTP-Deploy-Action`);
    logger.all(`or add a badge 🏷️ to your projects readme --> https://github.com/SamKirkland/FTP-Deploy-Action#badge`);
    logger.verbose(`Using the following excludes filters: ${JSON.stringify(args.exclude)}`);

    timings.start("hash");
    const localFiles = await getLocalFiles(args);
    timings.stop("hash");

    // the state file is managed by us, never deploy or delete it as if it were a normal file
    localFiles.data = localFiles.data.filter(item => item.name !== args["state-name"]);

    const client = new ftp.Client(args.timeout);

    global.reconnect = async function () {
        timings.start("connecting");
        await connect(client, args, logger);
        timings.stop("connecting");
    }


    let totalBytesUploaded = 0;
    try {
        await global.reconnect();

        const serverFiles = await getServerFiles(client, logger, timings, args);
        serverFiles.data = serverFiles.data.filter(item => item.name !== args["state-name"]);

        timings.start("logging");
        const diffTool: IDiff = new HashDiff();

        logger.standard(`----------------------------------------------------------------`);
        logger.standard(`Local Files:\t${formatNumber(localFiles.data.length)}`);
        logger.standard(`Server Files:\t${formatNumber(serverFiles.data.length)}`);
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
            const syncProvider = new FTPSyncProvider(client, logger, timings, args["local-dir"], args["server-dir"], args["state-name"], args["dry-run"]);
            await syncProvider.syncLocalToServer(diffs, localFiles);
        }
        finally {
            timings.stop("upload");
        }
    }
    catch (error) {
        prettyError(logger, args, error);
        throw error;
    }
    finally {
        client.close();
        timings.stop("total");
    }


    const uploadSpeed = prettyBytes(totalBytesUploaded / (timings.getTime("upload") / 1000));

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
}