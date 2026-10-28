import { IDiff, IFileList, Record } from "./types";
import fs from "fs";
import crypto from "crypto";

export async function fileHash(filename: string, algorithm: "md5" | "sha1" | "sha256" | "sha512"): Promise<string> {
    return new Promise((resolve, reject) => {
        // Algorithm depends on availability of OpenSSL on platform
        // Another algorithms: "sha1", "md5", "sha256", "sha512" ...
        let shasum = crypto.createHash(algorithm);
        try {
            let s = fs.createReadStream(filename);
            s.on("data", function (data: any) {
                shasum.update(data)
            });

            s.on("error", function (error) {
                reject(error);
            });

            // making digest
            s.on("end", function () {
                const hash = shasum.digest("hex")
                return resolve(hash);
            });
        }
        catch (error) {
            return reject("calc fail");
        }
    });
}

/**
 * Compares by code point. localeCompare ignores case/punctuation differences on some platforms, which breaks the
 * merge-join below and makes the order depend on the machine's locale
 */
export function compareNames(first: string, second: string): number {
    return first < second ? -1 : first > second ? 1 : 0;
}

/** sorted copy without duplicate names (first one wins) */
function sortedUnique(records: Record[]): Record[] {
    const sorted = [...records].sort((first, second) => compareNames(first.name, second.name));
    return sorted.filter((record, index) => index === 0 || sorted[index - 1].name !== record.name);
}

export class HashDiff implements IDiff {
    getDiffs(localFiles: IFileList, serverFiles: IFileList) {
        const uploadList: Record[] = [];
        const deleteList: Record[] = [];
        const replaceList: Record[] = [];

        const sameList: Record[] = [];

        let sizeUpload = 0;
        let sizeDelete = 0;
        let sizeReplace = 0;

        // alphabetize each list based off path
        const localFilesSorted = sortedUnique(localFiles.data);
        const serverFilesSorted = sortedUnique(serverFiles.data);

        let localPosition = 0;
        let serverPosition = 0;
        while (localPosition + serverPosition < localFilesSorted.length + serverFilesSorted.length) {
            let localFile: Record | undefined = localFilesSorted[localPosition];
            let serverFile: Record | undefined = serverFilesSorted[serverPosition];

            let fileNameCompare = 0;
            if (localFile === undefined) {
                fileNameCompare = 1;
            }
            if (serverFile === undefined) {
                fileNameCompare = -1;
            }
            if (localFile !== undefined && serverFile !== undefined) {
                fileNameCompare = compareNames(localFile.name, serverFile.name);
            }

            if (fileNameCompare < 0) {
                uploadList.push(localFile);
                sizeUpload += localFile.size ?? 0;
                localPosition += 1;
            }
            else if (fileNameCompare > 0) {
                deleteList.push(serverFile);
                sizeDelete += serverFile.size ?? 0;
                serverPosition += 1;
            }
            else if (fileNameCompare === 0) {
                // paths are a match
                if (localFile.type === "file" && serverFile.type === "file") {
                    if (localFile.hash === serverFile.hash) {
                        sameList.push(localFile);
                    }
                    else {
                        sizeReplace += localFile.size ?? 0;
                        replaceList.push(localFile);
                    }
                }
                else if (localFile.type !== serverFile.type) {
                    // a file became a folder (or the other way around), the old one has to go before the new one is created
                    deleteList.push(serverFile);
                    sizeDelete += serverFile.size ?? 0;
                    uploadList.push(localFile);
                    sizeUpload += localFile.size ?? 0;
                }

                localPosition += 1;
                serverPosition += 1;
            }
        }

        // optimize modifications
        const foldersToDelete = new Set(deleteList.filter((item) => item.type === "folder").map((item) => item.name));

        // remove files/folders that have a parent folder we plan on deleting (removing a folder removes its contents)
        const optimizedDeleteList = deleteList.filter((itemToDelete) => {
            // a slash at the very end belongs to the item itself, not a parent
            const name = itemToDelete.name.endsWith("/") ? itemToDelete.name.slice(0, -1) : itemToDelete.name;
            let slash = name.indexOf("/");
            while (slash !== -1) {
                // folder names can be stored with or without a trailing slash
                if (foldersToDelete.has(name.substring(0, slash)) || foldersToDelete.has(name.substring(0, slash + 1))) {
                    return false;
                }
                slash = name.indexOf("/", slash + 1);
            }

            return true;
        });

        return {
            upload: uploadList,
            delete: optimizedDeleteList,
            replace: replaceList,
            same: sameList,
            sizeDelete,
            sizeReplace,
            sizeUpload
        };
    }
}
