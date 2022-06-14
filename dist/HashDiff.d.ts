import { IDiff, IFileList, Record } from "./types";
export declare function fileHash(filename: string, algorithm: "md5" | "sha1" | "sha256" | "sha512"): Promise<string>;
export declare class HashDiff implements IDiff {
    getDiffs(localFiles: IFileList, serverFiles: IFileList): {
        upload: Record[];
        delete: Record[];
        replace: Record[];
        same: Record[];
        sizeDelete: number;
        sizeReplace: number;
        sizeUpload: number;
    };
}
