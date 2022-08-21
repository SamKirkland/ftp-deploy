import prettyBytes from "pretty-bytes";
import type * as ftp from "basic-ftp";
import { DiffResult, ErrorCode, IFile, IFilePath, IFolder, isFile, isFolder, Record } from "./types";
import { ILogger, pluralize, retryRequest, ITimings } from "./utilities";

export async function ensureDir(client: ftp.Client, logger: ILogger, timings: ITimings, folder: string): Promise<void> {
    timings.start("changingDir");
    logger.verbose(`  changing dir to ${folder}`);

    await retryRequest(logger, async () => await client.ensureDir(folder));

    logger.verbose(`  dir changed`);
    timings.stop("changingDir");
}

interface ISyncProvider {
    createFolder(folder: IFolder): Promise<void>;
    removeFile(file: IFile): Promise<void>;
    removeFolder(folder: IFolder): Promise<void>;

    /**
     * @param file file can include folder(s)
     * Note working dir is modified and NOT reset after upload
     * For now we are going to reset it - but this will be removed for performance
     */
    uploadFile(file: IFile, type: "upload" | "replace"): Promise<void>;

    syncLocalToServer(diffs: DiffResult): Promise<void>;
}

export class FTPSyncProvider implements ISyncProvider {
    constructor(client: ftp.Client, logger: ILogger, timings: ITimings, localPath: string, serverPath: string, stateName: string, dryRun: boolean, syncPosixModes: boolean) {
        this.client = client;
        this.logger = logger;
        this.timings = timings;
        this.localPath = localPath;
        this.serverPath = serverPath;
        this.stateName = stateName;
        this.dryRun = dryRun;
        this.syncPosixModes = syncPosixModes;
    }

    private client: ftp.Client;
    private logger: ILogger;
    private timings: ITimings;
    private localPath: string;
    private serverPath: string;
    private dryRun: boolean;
    private syncPosixModes: boolean;
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

    async createFolder(folder: Record) {
        this.logger.all(`creating folder "${folder.name + "/"}"`);

        if (this.dryRun === true) {
            return;
        }

        const path = this.getFileBreadcrumbs(folder.name + "/");

        if (path.folders === null) {
            this.logger.verbose(`  no need to change dir`);
        }
        else {
            await ensureDir(this.client, this.logger, this.timings, path.folders.join("/"));
        }

        await this.syncMode(folder);

        // navigate back to the root folder
        await this.upDir(path.folders?.length);

        this.logger.verbose(`  completed`);
    }

    async removeFile(file: IFile) {
        this.logger.all(`removing "${file.name}"`);

        if (this.dryRun === false) {
            try {
                await retryRequest(this.logger, async () => await this.client.remove(file.name));
            }
            catch (e: any) {
                // this error is common when a file was deleted on the server directly
                if (e.code === ErrorCode.FileNotFoundOrNoAccess) {
                    this.logger.standard("File not found or you don't have access to the file - skipping...");
                }
                else {
                    throw e;
                }
            }
        }
        this.logger.verbose(`  file removed`);

        this.logger.verbose(`  completed`);
    }

    async removeFolder(folder: IFolder) {
        const absoluteFolderPath = "/" + (this.serverPath.startsWith("./") ? this.serverPath.replace("./", "") : this.serverPath) + folder.name;
        this.logger.all(`removing folder "${absoluteFolderPath}"`);

        if (this.dryRun === false) {
            await retryRequest(this.logger, async () => await this.client.removeDir(absoluteFolderPath));
        }

        this.logger.verbose(`  completed`);
    }

    async uploadFile(file: IFile, type: "upload" | "replace" = "upload") {
        const typePresent = type === "upload" ? "uploading" : "replacing";
        const typePast = type === "upload" ? "uploaded" : "replaced";
        this.logger.all(`${typePresent} "${file.name}"`);

        if (this.dryRun === false) {
            await retryRequest(this.logger, async () => await this.client.uploadFrom(this.localPath + file.name, file.name));
        }

        await this.syncMode(file);

        this.logger.verbose(`  file ${typePast}`);
    }

    async syncMode(file: Record) {
        if (!this.syncPosixModes) {
            return;
        }
        if (file.mode === undefined) {
            return;
        }

        this.logger.verbose(`Syncing posix mode for file ${file.name}`);

        const setModeCommand = `SITE CHMOD ${file.mode} ${file.name}`;

        if (this.dryRun === false) {
            await this.client.ftp.request(setModeCommand);
        }

        this.logger.verbose(`Setting file mode with command ${setModeCommand}`);
    }

    async syncLocalToServer(diffs: DiffResult) {
        const totalCount = diffs.delete.length + diffs.upload.length + diffs.replace.length;

        this.logger.all(`----------------------------------------------------------------`);
        this.logger.all(`Making changes to ${totalCount} ${pluralize(totalCount, "file/folder", "files/folders")} to sync server state`);
        this.logger.all(`Uploading: ${prettyBytes(diffs.sizeUpload)} -- Deleting: ${prettyBytes(diffs.sizeDelete)} -- Replacing: ${prettyBytes(diffs.sizeReplace)}`);
        this.logger.all(`----------------------------------------------------------------`);

        // create new folders
        const newFolder = diffs.upload.filter((item): item is IFolder => isFolder(item));
        for (const file of newFolder) {
            await this.createFolder(file);
        }

        // upload new files
        const newFiles = diffs.upload.filter((item): item is IFile => isFile(item)).filter(item => item.name !== this.stateName);
        for (const file of newFiles) {
            await this.uploadFile(file, "upload");
        }

        // replace new files
        const replaceFiles = diffs.replace.filter((item): item is IFile => isFile(item)).filter(item => item.name !== this.stateName);
        for (const file of replaceFiles) {
            // note: FTP will replace old files with new files. We run replacements after uploads to limit downtime
            await this.uploadFile(file, "replace");
        }

        // delete old files
        const deleteFiles = diffs.delete.filter((item): item is IFile => isFile(item));
        for (const file of deleteFiles) {
            await this.removeFile(file);
        }

        // delete old folders
        const deleteFolders = diffs.delete.filter((item): item is IFolder => isFolder(item));
        for (const file of deleteFolders) {
            await this.removeFolder(file);
        }

        this.logger.all(`----------------------------------------------------------------`);
        this.logger.all(`🎉 Sync complete. Saving current server state to "${this.serverPath + this.stateName}"`);
        if (this.dryRun === false) {
            await retryRequest(this.logger, async () => await this.client.uploadFrom(this.localPath + this.stateName, this.stateName));
        }
    }
}
