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
exports.HashDiff = exports.fileHash = void 0;
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
function fileHash(filename, algorithm) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            // Algorithm depends on availability of OpenSSL on platform
            // Another algorithms: "sha1", "md5", "sha256", "sha512" ...
            let shasum = crypto_1.default.createHash(algorithm);
            try {
                let s = fs_1.default.createReadStream(filename);
                s.on("data", function (data) {
                    shasum.update(data);
                });
                s.on("error", function (error) {
                    reject(error);
                });
                // making digest
                s.on("end", function () {
                    const hash = shasum.digest("hex");
                    return resolve(hash);
                });
            }
            catch (error) {
                return reject("calc fail");
            }
        });
    });
}
exports.fileHash = fileHash;
class HashDiff {
    getDiffs(localFiles, serverFiles) {
        var _a, _b, _c;
        const uploadList = [];
        const deleteList = [];
        const replaceList = [];
        const sameList = [];
        let sizeUpload = 0;
        let sizeDelete = 0;
        let sizeReplace = 0;
        // alphabetize each list based off path
        const localFilesSorted = localFiles.data.sort((first, second) => first.name.localeCompare(second.name));
        const serverFilesSorted = serverFiles.data.sort((first, second) => first.name.localeCompare(second.name));
        let localPosition = 0;
        let serverPosition = 0;
        while (localPosition + serverPosition < localFilesSorted.length + serverFilesSorted.length) {
            let localFile = localFilesSorted[localPosition];
            let serverFile = serverFilesSorted[serverPosition];
            let fileNameCompare = 0;
            if (localFile === undefined) {
                fileNameCompare = 1;
            }
            if (serverFile === undefined) {
                fileNameCompare = -1;
            }
            if (localFile !== undefined && serverFile !== undefined) {
                fileNameCompare = localFile.name.localeCompare(serverFile.name);
            }
            if (fileNameCompare < 0) {
                uploadList.push(localFile);
                sizeUpload += (_a = localFile.size) !== null && _a !== void 0 ? _a : 0;
                localPosition += 1;
            }
            else if (fileNameCompare > 0) {
                deleteList.push(serverFile);
                sizeDelete += (_b = serverFile.size) !== null && _b !== void 0 ? _b : 0;
                serverPosition += 1;
            }
            else if (fileNameCompare === 0) {
                // paths are a match
                if (localFile.type === "file" && serverFile.type === "file") {
                    if (localFile.hash === serverFile.hash) {
                        sameList.push(localFile);
                    }
                    else {
                        sizeReplace += (_c = localFile.size) !== null && _c !== void 0 ? _c : 0;
                        replaceList.push(localFile);
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
exports.HashDiff = HashDiff;
