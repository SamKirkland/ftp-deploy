import prettyBytes from "pretty-bytes";
import type * as ftp from "basic-ftp";
import { Readable } from "stream";
import { DiffResult, ErrorCode, IFileList, IFilePath, Record } from "./types";
import { ILogger, pluralize, retryRequest, ITimings } from "./utilities";

/**
 * Changes the working dir to {folder}, creating missing folders along the way.
 * Unlike basic-ftp's ensureDir, a failed MKD or CWD is reported instead of silently continuing in the wrong folder
 */
export async function ensureDir(client: ftp.Client, logger: ILogger, timings: ITimings, folder: string): Promise<void> {
    timings.start("changingDir");
    logger.verbose(`  changing dir to ${folder}`);

    try {
        if (folder.startsWith("/")) {
            await retryRequest(logger, async () => await client.cd("/"));
        }

        for (const segment of folder.split("/").filter(name => name !== "")) {
            try {
                await retryRequest(logger, async () => await client.cd(segment));
                continue;
            }
            catch (e: any) {
                // only a missing folder can be fixed by creating it
                if (segment === "." || segment === ".." || e?.code !== ErrorCode.FileNotFoundOrNoAccess) {
                    throw e;
                }
            }

            await retryRequest(logger, async () => await client.send("MKD " + segment));
            await retryRequest(logger, async () => await client.cd(segment));
        }
    }
    finally {
        timings.stop("changingDir");
    }

    logger.verbose(`  dir changed`);
}

/**
 * Checks if a file or folder exists, relative to the working dir. Used to tell "already gone" apart from "permission denied"
 * when the server answers 550. Returns undefined when the server gives us no way to find out
 */
export async function remoteExists(client: ftp.Client, remotePath: string, type: "file" | "folder"): Promise<boolean | undefined> {
    if (type === "file") {
        try {
            await client.size(remotePath);
            return true;
        }
        catch {
            // SIZE is optional and some servers refuse it for any reason, fall back to a listing
        }
    }

    const slash = remotePath.lastIndexOf("/");
    const parent = slash === -1 ? "" : remotePath.substring(0, slash);
    const name = remotePath.substring(slash + 1);

    try {
        const listing = await client.list(parent);
        return listing.some(item => item.name === name);
    }
    catch {
        return undefined;
    }
}

interface ISyncProvider {
    createFolder(folderPath: string): Promise<void>;
    removeFile(filePath: string): Promise<void>;
    removeFolder(folderPath: string): Promise<void>;

    /**
     * @param file file can include folder(s)
     * Note working dir is modified and NOT reset after upload
     * For now we are going to reset it - but this will be removed for performance
     */
    uploadFile(filePath: string, type: "upload" | "replace"): Promise<void>;

    syncLocalToServer(diffs: DiffResult, localState: IFileList): Promise<void>;
}

export class FTPSyncProvider implements ISyncProvider {
    constructor(client: ftp.Client, logger: ILogger, timings: ITimings, localPath: string, serverPath: string, stateName: string, dryRun: boolean) {
        this.client = client;
        this.logger = logger;
        this.timings = timings;
        this.localPath = localPath;
        this.serverPath = serverPath;
        this.stateName = stateName;
        this.dryRun = dryRun;
    }

    private client: ftp.Client;
    private logger: ILogger;
    private timings: ITimings;
    private localPath: string;
    private serverPath: string;
    private dryRun: boolean;
    private stateName: string;


    /**
     * Converts a file path (ex: "folder/otherfolder/file.txt") to an array of folder and a file path
     * @param fullPath
     */
    private getFileBreadcrumbs(fullPath: string): IFilePath {
        // todo see if this regex will work for nonstandard folder names
        // todo what happens if the path is relative to the root dir? (starts with /)
        const pathSplit = fullPath.split("/");
        const file = pathSplit?.pop() ?? ""; // get last item
        const folders = pathSplit.filter(folderName => folderName != "");

        return {
            folders: folders.length === 0 ? null : folders,
            file: file === "" ? null : file
        };
    }

    /**
     * Navigates up {dirCount} number of directories from the current working dir
     */
    private async upDir(dirCount: number | null | undefined): Promise<void> {
        if (typeof dirCount !== "number") {
            return;
        }

        // navigate back to the starting folder
        for (let i = 0; i < dirCount; i++) {
            await retryRequest(this.logger, async () => await this.client.cdup());
        }
    }

    /** absolute path of server-dir, undefined when the server does not support PWD */
    private serverDirAbsolute: string | null | undefined = null;

    /**
     * Goes back to server-dir after entering {depth} levels of folders
     */
    private async returnToServerDir(depth: number): Promise<void> {
        if (this.serverDirAbsolute === null) {
            try {
                this.serverDirAbsolute = await this.client.pwd();
            }
            catch {
                this.serverDirAbsolute = undefined;
            }
        }

        if (this.serverDirAbsolute !== undefined) {
            const serverDir = this.serverDirAbsolute;
            await retryRequest(this.logger, async () => await this.client.cd(serverDir));
        }
        else {
            await this.upDir(depth);
        }
    }

    async createFolder(folderPath: string) {
        this.logger.all(`creating folder "${folderPath + "/"}"`);

        if (this.dryRun === true) {
            return;
        }

        const path = this.getFileBreadcrumbs(folderPath + "/");

        if (path.folders === null) {
            this.logger.verbose(`  no need to change dir`);
            return;
        }

        // remember where server-dir is before leaving it
        if (this.serverDirAbsolute === null) {
            await this.returnToServerDir(0);
        }

        // parent folders are always created first (the diff is sorted), so one MKD with the full path is enough.
        // Creating every level separately makes deep paths cost a quadratic number of commands
        const fullPath = path.folders.join("/");
        let mkdirError: any;
        try {
            await retryRequest(this.logger, async () => await this.client.send("MKD " + fullPath));
        }
        catch (e: any) {
            // 550 is also the reply when the folder already exists, entering it below tells the two apart
            if (e?.code !== ErrorCode.FileNotFoundOrNoAccess) {
                throw e;
            }
            mkdirError = e;
        }

        // make sure the folder is usable
        this.timings.start("changingDir");
        try {
            await retryRequest(this.logger, async () => await this.client.cd(fullPath));
        }
        catch (e) {
            throw mkdirError ?? e;
        }
        finally {
            this.timings.stop("changingDir");
        }

        await this.returnToServerDir(path.folders.length);

        this.logger.verbose(`  completed`);
    }

    /**
     * A 550 reply means "not found" or "no access". Only "not found" is safe to skip, otherwise the file would stay on
     * the server while the state file forgets about it.
     * Other server errors (e.g. 451 when listing a missing folder) are skipped only when the item is confirmed to be gone
     */
    private async handleRemoveError(e: any, itemPath: string, type: "file" | "folder") {
        if (typeof e?.code !== "number") {
            // connection problems etc.
            throw e;
        }

        const exists = await remoteExists(this.client, itemPath, type);
        if (e.code !== ErrorCode.FileNotFoundOrNoAccess && exists !== false) {
            throw e;
        }

        if (exists === true) {
            this.logger.all(`"${itemPath}" still exists on the server, you probably don't have permission to delete it`);
            throw e;
        }

        // this is common when a file was deleted on the server directly
        if (type === "file") {
            this.logger.standard("File not found - skipping...");
        }
        else {
            this.logger.standard("Directory not found - skipping...");
        }
    }

    async removeFile(filePath: string) {
        this.logger.all(`removing "${filePath}"`);

        if (this.dryRun === false) {
            try {
                await retryRequest(this.logger, async () => await this.client.remove(filePath));
            }
            catch (e: any) {
                await this.handleRemoveError(e, filePath, "file");
            }
        }
        this.logger.verbose(`  file removed`);

        this.logger.verbose(`  completed`);
    }

    /**
     * Deletes a folder and everything in it using paths relative to the working dir.
     * basic-ftp's removeDir walks the tree with CWD/CDUP, which breaks on servers without CDUP and costs more round trips
     */
    private async removeFolderRecursive(folderPath: string): Promise<void> {
        const folder = folderPath.endsWith("/") ? folderPath.slice(0, -1) : folderPath;
        const contents = await retryRequest(this.logger, async () => await this.client.list(folder));

        for (const item of contents) {
            if (item.name === "." || item.name === "..") {
                continue;
            }

            const itemPath = folder + "/" + item.name;
            if (item.isDirectory) {
                await this.removeFolderRecursive(itemPath);
            }
            else {
                await retryRequest(this.logger, async () => await this.client.remove(itemPath));
            }
        }

        await retryRequest(this.logger, async () => await this.client.send("RMD " + folder));
    }

    async removeFolder(folderPath: string) {
        this.logger.all(`removing folder "${this.serverPath + folderPath}"`);

        if (this.dryRun === false) {
            try {
                // relative to server-dir (the working dir), an absolute path is wrong when the login dir is not the ftp root
                await this.removeFolderRecursive(folderPath);
            }
            catch (e: any) {
                await this.handleRemoveError(e, folderPath, "folder");
            }
        }

        this.logger.verbose(`  completed`);
    }

    private async removeItem(item: Record) {
        if (item.type === "file") {
            await this.removeFile(item.name);
        }
        else {
            await this.removeFolder(item.name);
        }
    }

    async uploadFile(filePath: string, type: "upload" | "replace" = "upload") {
        const typePresent = type === "upload" ? "uploading" : "replacing";
        const typePast = type === "upload" ? "uploaded" : "replaced";
        this.logger.all(`${typePresent} "${filePath}"`);

        if (this.dryRun === false) {
            await retryRequest(this.logger, async () => await this.client.uploadFrom(this.localPath + filePath, filePath));
        }

        this.logger.verbose(`  file ${typePast}`);
    }

    /**
     * @param localState saved to the server as the new state once everything is synced
     */
    async syncLocalToServer(diffs: DiffResult, localState: IFileList) {
        const totalCount = diffs.delete.length + diffs.upload.length + diffs.replace.length;

        this.logger.all(`----------------------------------------------------------------`);
        this.logger.all(`Making changes to ${totalCount} ${pluralize(totalCount, "file/folder", "files/folders")} to sync server state`);
        this.logger.all(`Uploading: ${prettyBytes(diffs.sizeUpload)} -- Deleting: ${prettyBytes(diffs.sizeDelete)} -- Replacing: ${prettyBytes(diffs.sizeReplace)}`);
        this.logger.all(`----------------------------------------------------------------`);

        // Deletes normally run last to limit downtime. But when something is deleted and uploaded under the same name
        // (a file that became a folder, or a rename that only changes case on a case insensitive server) the delete
        // has to run first, otherwise it fails or removes what was just uploaded
        const normalize = (name: string) => (name.endsWith("/") ? name.slice(0, -1) : name).toLowerCase();
        const uploadNames = new Set([...diffs.upload, ...diffs.replace].map(item => normalize(item.name)));
        const earlyDeletes = diffs.delete.filter(item => uploadNames.has(normalize(item.name)));
        const lateDeletes = diffs.delete.filter(item => !earlyDeletes.includes(item));

        for (const item of earlyDeletes.filter(item => item.type === "file")) {
            await this.removeItem(item);
        }
        for (const item of earlyDeletes.filter(item => item.type === "folder")) {
            await this.removeItem(item);
        }

        // create new folders
        for (const file of diffs.upload.filter(item => item.type === "folder")) {
            await this.createFolder(file.name);
        }

        // upload new files
        for (const file of diffs.upload.filter(item => item.type === "file").filter(item => item.name !== this.stateName)) {
            await this.uploadFile(file.name, "upload");
        }

        // replace new files
        for (const file of diffs.replace.filter(item => item.type === "file").filter(item => item.name !== this.stateName)) {
            // note: FTP will replace old files with new files. We run replacements after uploads to limit downtime
            await this.uploadFile(file.name, "replace");
        }

        // delete old files
        for (const item of lateDeletes.filter(item => item.type === "file")) {
            await this.removeItem(item);
        }

        // delete old folders
        for (const item of lateDeletes.filter(item => item.type === "folder")) {
            await this.removeItem(item);
        }

        this.logger.all(`----------------------------------------------------------------`);
        this.logger.all(`🎉 Sync complete. Saving current server state to "${this.serverPath + this.stateName}"`);
        if (this.dryRun === false) {
            // state-name may point into a sub folder that does not exist yet (Action#468)
            const stateFolder = this.stateName.lastIndexOf("/") > 0 ? this.stateName.slice(0, this.stateName.lastIndexOf("/")) : undefined;
            if (stateFolder !== undefined) {
                await this.createFolder(stateFolder);
            }

            // uploaded from memory, writing it into local-dir first would modify the folder being deployed
            const stateAsString = JSON.stringify(localState, undefined, 4);
            await retryRequest(this.logger, async () => await this.client.uploadFrom(Readable.from([Buffer.from(stateAsString, "utf8")]), this.stateName));
        }
    }
}
