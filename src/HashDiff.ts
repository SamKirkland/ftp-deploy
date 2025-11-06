import { IDiff, IFileList, Record } from "./types";
import fs from "fs";
import crypto from "crypto";
import { ILogger } from "./utilities";

/**
 * Enum representing the result of comparing two file names
 */
enum FileComparisonResult {
    UPLOAD_NEEDED = -1,      // Local file should be uploaded to server
    NAMES_MATCH = 0,         // File names are identical (check for content differences)
    DELETE_NEEDED = 1        // Server file should be deleted
}

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

export class HashDiff implements IDiff {
    getDiffs(logger: ILogger, localFiles: IFileList, serverFiles: IFileList, enableUpload: boolean, enableReplace: boolean, enableDelete: boolean) {
        const uploadList: Record[] = [];
        const deleteList: Record[] = [];
        const replaceList: Record[] = [];

        const sameList: Record[] = [];

        let sizeUpload = 0;
        let sizeDelete = 0;
        let sizeReplace = 0;

        // alphabetize each list based off path
        const localFilesSorted = localFiles.data.sort((first, second) => first.name.localeCompare(second.name));
        const serverFilesSorted = serverFiles.data.sort((first, second) => first.name.localeCompare(second.name));

        let localPosition = 0;
        let serverPosition = 0;
        while (localPosition + serverPosition < localFilesSorted.length + serverFilesSorted.length) {
            let localFile: Record | undefined = localFilesSorted[localPosition];
            let serverFile: Record | undefined = serverFilesSorted[serverPosition];

            // Determine the relationship between local and server files
            let fileNameCompare: FileComparisonResult = FileComparisonResult.NAMES_MATCH;
            if (localFile === undefined) {
                // Local file does not exist, server file should be deleted
                fileNameCompare = FileComparisonResult.DELETE_NEEDED;
            }
            if (serverFile === undefined) {
                // Server file does not exist, local file should be uploaded
                fileNameCompare = FileComparisonResult.UPLOAD_NEEDED;
            }
            if (localFile !== undefined && serverFile !== undefined) {
                // Both files exist, compare their names
                fileNameCompare = localFile.name.localeCompare(serverFile.name) as FileComparisonResult;
            }

            if (fileNameCompare === FileComparisonResult.UPLOAD_NEEDED) {
                // Local file exists, server file does not - it needs to be uploaded
                if (enableUpload) {
                    uploadList.push(localFile);
                    sizeUpload += localFile.size ?? 0;
                }
                else {
                    logger.verbose(`Skipping upload of ${localFile.name} because enableUpload is false`);
                }
                localPosition += 1;
            }
            else if (fileNameCompare === FileComparisonResult.DELETE_NEEDED) {
                // Server file exists, local file does not - it needs to be deleted
                if (enableDelete) {
                    deleteList.push(serverFile);
                    sizeDelete += serverFile.size ?? 0;
                }
                else {
                    logger.verbose(`Skipping delete of ${serverFile.name} because enableDelete is false`);
                }
                serverPosition += 1;
            }
            else if (fileNameCompare === FileComparisonResult.NAMES_MATCH) {
                // File names match - check if content (hash) is different
                if (localFile.type === "file" && serverFile.type === "file") {
                    if (localFile.hash === serverFile.hash) {
                        // File names and hashes are identical
                        sameList.push(localFile);
                    }
                    else {
                        // Files have same name but different hash - replace needed
                        if (enableReplace) {
                            sizeReplace += localFile.size ?? 0;
                            replaceList.push(localFile);
                        }
                        else {
                            logger.verbose(`Skipping replace of ${localFile.name} because enableReplace is false`);
                        }
                    }
                }

                localPosition += 1;
                serverPosition += 1;
            }
        }

        // optimize modifications
        let foldersToDelete = deleteList.filter((item) => item.type === "folder");

        // remove files/folders that have a nested parent folder we plan on deleting
        const optimizedDeleteList = deleteList.filter((itemToDelete) => {
            const parentFolderIsBeingDeleted = foldersToDelete.find((folder) => {
                const isSameFile = itemToDelete.name === folder.name;
                const parentFolderExists = itemToDelete.name.startsWith(folder.name);

                return parentFolderExists && !isSameFile;
            }) !== undefined;

            if (parentFolderIsBeingDeleted) {
                // a parent folder is being deleted, no need to delete this one
                return false;
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
