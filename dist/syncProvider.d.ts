import type * as ftp from "basic-ftp";
import { DiffResult, Record } from "./types";
import { ILogger, ITimings } from "./utilities";
export declare function ensureDir(client: ftp.Client, logger: ILogger, timings: ITimings, folder: string): Promise<void>;
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
    syncLocalToServer(diffs: DiffResult): Promise<void>;
}
export declare class FTPSyncProvider implements ISyncProvider {
    constructor(client: ftp.Client, logger: ILogger, timings: ITimings, localPath: string, serverPath: string, stateName: string, dryRun: boolean, syncPosixModes: boolean);
    private client;
    private logger;
    private timings;
    private localPath;
    private serverPath;
    private dryRun;
    private syncPosixModes;
    private stateName;
    /**
     * Converts a file path (ex: "folder/otherfolder/file.txt") to an array of folder and a file path
     * @param fullPath
     */
    private getFileBreadcrumbs;
    /**
     * Navigates up {dirCount} number of directories from the current working dir
     */
    private upDir;
    createFolder(folderPath: string): Promise<void>;
    removeFile(filePath: string): Promise<void>;
    removeFolder(folderPath: string): Promise<void>;
    uploadFile(filePath: string, type?: "upload" | "replace"): Promise<void>;
    syncMode(file: Record): Promise<void>;
    syncLocalToServer(diffs: DiffResult): Promise<void>;
}
export {};
