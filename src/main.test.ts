import { HashDiff } from "./HashDiff";
import { IFileList, currentSyncFileVersion, IFile, IFtpDeployArgumentsWithDefaults, DiffResult } from "./types";
import { Record } from "./types";
import { applyExcludeFilter, getDefaultSettings, ILogger, Timings } from "./utilities";
import path from "path";
import FtpSrv from "ftp-srv";
import { getLocalFiles } from "./localFiles";
import { FTPSyncProvider } from "./syncProvider";
import { deploy, getServerFiles } from "./deploy";
import { Stats as readdirStats } from "@jsdevtools/readdir-enhanced";
import { excludeDefaults } from "./module";

const tenFiles: Record[] = [
    {
        type: "file",
        name: "a",
        size: 1000,
        hash: "hash1",
    },
    {
        type: "file",
        name: "b",
        size: 1000,
        hash: "hash2",
    },
    {
        type: "file",
        name: "c",
        size: 1000,
        hash: "hash3",
    },
    {
        type: "file",
        name: "d",
        size: 1000,
        hash: "hash4",
    },
    {
        type: "file",
        name: "e",
        size: 1000,
        hash: "hash5",
    },
    {
        type: "file",
        name: "f",
        size: 1000,
        hash: "hash6",
    },
    {
        type: "file",
        name: "g",
        size: 1000,
        hash: "hash7",
    },
    {
        type: "file",
        name: "h",
        size: 1000,
        hash: "hash8",
    },
    {
        type: "file",
        name: "i",
        size: 1000,
        hash: "hash9",
    },
    {
        type: "file",
        name: "j",
        size: 1000,
        hash: "hash10",
    }
];

class MockedLogger implements ILogger {
    all() { };
    standard() { };
    verbose() { };
}

// Test utility functions for FtpSrv testing
function createTestFileList(files: Array<{name: string, size: number, hash: string, type?: "file" | "folder"}>): IFileList {
    return {
        version: currentSyncFileVersion,
        description: "",
        generatedTime: new Date().getTime(),
        data: files.map(file => ({
            type: file.type || "file",
            name: file.name,
            size: file.type === "folder" ? undefined : file.size,
            hash: file.type === "folder" ? undefined : file.hash
        })) as Record[]
    };
}

function createMockFtpClient() {
    return {
        ensureDir: jest.fn(),
        uploadFrom: jest.fn(),
        remove: jest.fn(),
        removeDir: jest.fn(),
        cdup: jest.fn()
    };
}

function setupSyncProviderSpies(syncProvider: FTPSyncProvider) {
    return {
        uploadFile: jest.spyOn(syncProvider, "uploadFile"),
        removeFile: jest.spyOn(syncProvider, "removeFile"),
        removeFolder: jest.spyOn(syncProvider, "removeFolder"),
        createFolder: jest.spyOn(syncProvider, "createFolder")
    };
}

async function testEnableOption(
    localFiles: IFileList,
    serverFiles: IFileList,
    enableUpload: boolean,
    enableReplace: boolean,
    enableDelete: boolean,
    expectedCalls: {
        uploadFile?: Array<{file: string, type: "upload" | "replace"}>,
        removeFile?: string[],
        removeFolder?: string[],
        createFolder?: string[]
    }
) {
    const mockedLogger = new MockedLogger();
    const mockedTimings = new Timings();
    
    // Generate diffs with the specified enable options
    const hashDiff = new HashDiff();
    const diffs = hashDiff.getDiffs(mockedLogger, localFiles, serverFiles, enableUpload, enableReplace, enableDelete);
    
    // Create mock client and sync provider
    const mockClient = createMockFtpClient();
    const syncProvider = new FTPSyncProvider(mockClient as any, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false);
    const spies = setupSyncProviderSpies(syncProvider);
    
    // Execute the sync
    await syncProvider.syncLocalToServer(diffs);
    
    // Verify expected calls
    if (expectedCalls.uploadFile) {
        expect(spies.uploadFile).toHaveBeenCalledTimes(expectedCalls.uploadFile.length);
        expectedCalls.uploadFile.forEach((call, index) => {
            expect(spies.uploadFile).toHaveBeenNthCalledWith(index + 1, call.file, call.type);
        });
    } else {
        expect(spies.uploadFile).toHaveBeenCalledTimes(0);
    }
    
    if (expectedCalls.removeFile) {
        expect(spies.removeFile).toHaveBeenCalledTimes(expectedCalls.removeFile.length);
        expectedCalls.removeFile.forEach((file, index) => {
            expect(spies.removeFile).toHaveBeenNthCalledWith(index + 1, file);
        });
    } else {
        expect(spies.removeFile).toHaveBeenCalledTimes(0);
    }
    
    if (expectedCalls.removeFolder) {
        expect(spies.removeFolder).toHaveBeenCalledTimes(expectedCalls.removeFolder.length);
        expectedCalls.removeFolder.forEach((folder, index) => {
            expect(spies.removeFolder).toHaveBeenNthCalledWith(index + 1, folder);
        });
    } else {
        expect(spies.removeFolder).toHaveBeenCalledTimes(0);
    }
    
    if (expectedCalls.createFolder) {
        expect(spies.createFolder).toHaveBeenCalledTimes(expectedCalls.createFolder.length);
        expectedCalls.createFolder.forEach((folder, index) => {
            expect(spies.createFolder).toHaveBeenNthCalledWith(index + 1, folder);
        });
    } else {
        expect(spies.createFolder).toHaveBeenCalledTimes(0);
    }
    
    // Verify state file upload (should always happen)
    expect(mockClient.uploadFrom).toHaveBeenCalledWith("local-dir/state-name", "state-name");
    
    return { diffs, spies, mockClient };
}

describe("HashDiff", () => {
    const thing = new HashDiff();
    const logger = new MockedLogger();
    const emptyFileList: IFileList = { version: currentSyncFileVersion, description: "", generatedTime: new Date().getTime(), data: [] };
    const minimalFileList: IFileList = { version: currentSyncFileVersion, description: "", generatedTime: new Date().getTime(), data: tenFiles };

    test("Empty Client, Empty Server", () => {
        const diffs = thing.getDiffs(logger, emptyFileList, emptyFileList, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Empty Server", () => {
        const diffs = thing.getDiffs(logger, minimalFileList, emptyFileList, true, true, true);

        expect(diffs.upload.length).toEqual(10);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(10000);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Empty Client, Minimal Server", () => {
        const diffs = thing.getDiffs(logger, emptyFileList, minimalFileList, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(10);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(10000);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Minimal Server - No Diffs", () => {
        const diffs = thing.getDiffs(logger, minimalFileList, minimalFileList, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Minimal Server", () => {
        const minimalFileList2: IFileList = {
            ...minimalFileList,
            data: [
                ...minimalFileList.data,
                {
                    type: "file",
                    name: "zzzz",
                    size: 1000,
                    hash: "hash",
                }
            ]
        };
        const diffs = thing.getDiffs(logger, minimalFileList2, minimalFileList, true, true, true);

        expect(diffs.upload.length).toEqual(1);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(1000);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Minimal Server 2", () => {
        const minimalFileList2: IFileList = {
            ...minimalFileList,
            data: [
                ...minimalFileList.data,
                {
                    type: "file",
                    name: "zzzz",
                    size: 1000,
                    hash: "hash",
                }
            ]
        };
        const diffs = thing.getDiffs(logger, minimalFileList, minimalFileList2, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(1);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(1000);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Delete folder with nested content", () => {
        const clientState: IFileList = {
            ...emptyFileList,
            data: [
                {
                    type: "folder",
                    name: "folder/",
                    size: undefined,
                }
            ]
        };

        const serverState: IFileList = {
            ...emptyFileList,
            data: [
                {
                    type: "folder",
                    name: "folder/",
                    size: undefined,
                },
                {
                    type: "folder",
                    name: "folder/subFolder/",
                    size: undefined,
                },
                {
                    type: "file",
                    name: "folder/subFolder/file.txt",
                    size: 1000,
                    hash: "fakeHashContent"
                }
            ]
        };

        const diffs = thing.getDiffs(logger, clientState, serverState, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(1);
        expect(diffs.delete).toStrictEqual([{ type: "folder", name: "folder/subFolder/", size: undefined }]);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(1000);
        expect(diffs.sizeReplace).toEqual(0);
    });

    describe("enableUpload option", () => {
        test("enableUpload=false prevents uploads", () => {
            const diffs = thing.getDiffs(logger, minimalFileList, emptyFileList, false, true, true);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("enableUpload=true allows uploads", () => {
            const diffs = thing.getDiffs(logger, minimalFileList, emptyFileList, true, true, true);

            expect(diffs.upload.length).toEqual(10);
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(10000);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("enableUpload=false with mixed scenario", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "newFile.txt",
                        size: 500,
                        hash: "newHash",
                    },
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "changedHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "originalHash",
                    },
                    {
                        type: "file",
                        name: "toDelete.txt",
                        size: 200,
                        hash: "deleteHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, false, true, true);

            expect(diffs.upload.length).toEqual(0); // Upload blocked
            expect(diffs.delete.length).toEqual(1); // Delete allowed
            expect(diffs.replace.length).toEqual(1); // Replace allowed

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(200);
            expect(diffs.sizeReplace).toEqual(1000);
        });
    });

    describe("enableDelete option", () => {
        test("enableDelete=false prevents deletions", () => {
            const diffs = thing.getDiffs(logger, emptyFileList, minimalFileList, true, true, false);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("enableDelete=true allows deletions", () => {
            const diffs = thing.getDiffs(logger, emptyFileList, minimalFileList, true, true, true);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(10);
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(10000);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("enableDelete=false with mixed scenario", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "newFile.txt",
                        size: 500,
                        hash: "newHash",
                    },
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "changedHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "originalHash",
                    },
                    {
                        type: "file",
                        name: "toDelete.txt",
                        size: 200,
                        hash: "deleteHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, true, true, false);

            expect(diffs.upload.length).toEqual(1); // Upload allowed
            expect(diffs.delete.length).toEqual(0); // Delete blocked
            expect(diffs.replace.length).toEqual(1); // Replace allowed

            expect(diffs.sizeUpload).toEqual(500);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(1000);
        });
    });

    describe("enableReplace option", () => {
        test("enableReplace=false prevents replacements", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "file.txt",
                        size: 1000,
                        hash: "newHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "file.txt",
                        size: 1000,
                        hash: "oldHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, true, false, true);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("enableReplace=true allows replacements", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "file.txt",
                        size: 1000,
                        hash: "newHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "file.txt",
                        size: 1000,
                        hash: "oldHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, true, true, true);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(1);

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(1000);
        });

        test("enableReplace=false with mixed scenario", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "newFile.txt",
                        size: 500,
                        hash: "newHash",
                    },
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "changedHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "originalHash",
                    },
                    {
                        type: "file",
                        name: "toDelete.txt",
                        size: 200,
                        hash: "deleteHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, true, false, true);

            expect(diffs.upload.length).toEqual(1); // Upload allowed
            expect(diffs.delete.length).toEqual(1); // Delete allowed
            expect(diffs.replace.length).toEqual(0); // Replace blocked

            expect(diffs.sizeUpload).toEqual(500);
            expect(diffs.sizeDelete).toEqual(200);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("files with same hash are not replaced regardless of enableReplace", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "file.txt",
                        size: 1000,
                        hash: "sameHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "file.txt",
                        size: 1000,
                        hash: "sameHash",
                    }
                ]
            };

            const diffsenableReplace = thing.getDiffs(logger, localFiles, serverFiles, true, true, true);
            const diffsBlockReplace = thing.getDiffs(logger, localFiles, serverFiles, true, false, true);

            // Both should have same results since files are identical
            expect(diffsenableReplace.replace.length).toEqual(0);
            expect(diffsBlockReplace.replace.length).toEqual(0);
            expect(diffsenableReplace.same.length).toEqual(1);
            expect(diffsBlockReplace.same.length).toEqual(1);
        });
    });

    describe("combined boolean options", () => {
        test("all options false - no operations allowed", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "newFile.txt",
                        size: 500,
                        hash: "newHash",
                    },
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "changedHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "originalHash",
                    },
                    {
                        type: "file",
                        name: "toDelete.txt",
                        size: 200,
                        hash: "deleteHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, false, false, false);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("only enableUpload=true", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "newFile.txt",
                        size: 500,
                        hash: "newHash",
                    },
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "changedHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "originalHash",
                    },
                    {
                        type: "file",
                        name: "toDelete.txt",
                        size: 200,
                        hash: "deleteHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, true, false, false);

            expect(diffs.upload.length).toEqual(1); // Only upload allowed
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(500);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("only enableDelete=true", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "newFile.txt",
                        size: 500,
                        hash: "newHash",
                    },
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "changedHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "originalHash",
                    },
                    {
                        type: "file",
                        name: "toDelete.txt",
                        size: 200,
                        hash: "deleteHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, false, false, true);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(1); // Only delete allowed
            expect(diffs.replace.length).toEqual(0);

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(200);
            expect(diffs.sizeReplace).toEqual(0);
        });

        test("only enableReplace=true", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "newFile.txt",
                        size: 500,
                        hash: "newHash",
                    },
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "changedHash",
                    }
                ]
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "file",
                        name: "existingFile.txt",
                        size: 1000,
                        hash: "originalHash",
                    },
                    {
                        type: "file",
                        name: "toDelete.txt",
                        size: 200,
                        hash: "deleteHash",
                    }
                ]
            };

            const diffs = thing.getDiffs(logger, localFiles, serverFiles, false, true, false);

            expect(diffs.upload.length).toEqual(0);
            expect(diffs.delete.length).toEqual(0);
            expect(diffs.replace.length).toEqual(1); // Only replace allowed

            expect(diffs.sizeUpload).toEqual(0);
            expect(diffs.sizeDelete).toEqual(0);
            expect(diffs.sizeReplace).toEqual(1000);
        });

        test("folder operations respect enableDelete option", () => {
            const localFiles: IFileList = {
                ...emptyFileList,
                data: []
            };

            const serverFiles: IFileList = {
                ...emptyFileList,
                data: [
                    {
                        type: "folder",
                        name: "folderToDelete/",
                        size: undefined,
                    },
                    {
                        type: "file",
                        name: "fileToDelete.txt",
                        size: 100,
                        hash: "fileHash",
                    }
                ]
            };

            const diffsenableDelete = thing.getDiffs(logger, localFiles, serverFiles, true, true, true);
            const diffsBlockDelete = thing.getDiffs(logger, localFiles, serverFiles, true, true, false);

            expect(diffsenableDelete.delete.length).toEqual(2);
            expect(diffsBlockDelete.delete.length).toEqual(0);

            expect(diffsenableDelete.sizeDelete).toEqual(100);
            expect(diffsBlockDelete.sizeDelete).toEqual(0);
        });
    });
});

describe("FTP sync commands", () => {
    const mockedLogger = new MockedLogger();
    const mockedTimings = new Timings();

    test("upload file", async () => {
        const hashDiff = new HashDiff();
        const localFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: [
                {
                    type: "file",
                    name: "path/file.txt",
                    size: 1000,
                    hash: "hash2",
                }
            ]
        };
        const serverFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: []
        };
        const diffs = hashDiff.getDiffs(mockedLogger, localFiles, serverFiles, true, true, true);

        expect(diffs.upload.length).toEqual(1);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(1000);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);

        const mockClient = {
            ensureDir() { },
            uploadFrom() { },
        };
        const syncProvider = new FTPSyncProvider(mockClient as any, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false);
        const spyRemoveFile = jest.spyOn(syncProvider, "uploadFile");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        await syncProvider.syncLocalToServer(diffs);

        expect(spyRemoveFile).toHaveBeenCalledTimes(1);
        expect(spyRemoveFile).toHaveBeenCalledWith("path/file.txt", "upload");

        expect(mockClientUploadFrom).toHaveBeenCalledTimes(2);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/path/file.txt", "path/file.txt");
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(2, "local-dir/state-name", "state-name");
    });

    test("rename file", async () => {
        const hashDiff = new HashDiff();
        const localFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: [
                {
                    type: "file",
                    name: "path/newName.txt",
                    size: 1000,
                    hash: "hash1",
                }
            ]
        };
        const serverFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: [
                {
                    type: "file",
                    name: "path/oldFile.txt",
                    size: 1000,
                    hash: "hash1",
                }
            ]
        };
        const diffs = hashDiff.getDiffs(mockedLogger, localFiles, serverFiles, true, true, true);

        expect(diffs.upload.length).toEqual(1);
        expect(diffs.delete.length).toEqual(1);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(1000);
        expect(diffs.sizeDelete).toEqual(1000);
        expect(diffs.sizeReplace).toEqual(0);

        const mockClient = {
            ensureDir() { },
            remove() { },
            uploadFrom() { },
        };
        const syncProvider = new FTPSyncProvider(mockClient as any, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false);
        const spyUploadFile = jest.spyOn(syncProvider, "uploadFile");
        const spyRemoveFile = jest.spyOn(syncProvider, "removeFile");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        const mockClientRemove = jest.spyOn(mockClient, "remove");
        await syncProvider.syncLocalToServer(diffs);

        expect(spyRemoveFile).toHaveBeenCalledTimes(1);
        expect(spyRemoveFile).toHaveBeenCalledWith("path/oldFile.txt");

        expect(spyUploadFile).toHaveBeenCalledTimes(1);
        expect(spyUploadFile).toHaveBeenCalledWith("path/newName.txt", "upload");

        expect(mockClientRemove).toHaveBeenCalledTimes(1);
        expect(mockClientRemove).toHaveBeenNthCalledWith(1, "path/oldFile.txt");

        expect(mockClientUploadFrom).toHaveBeenCalledTimes(2);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/path/newName.txt", "path/newName.txt");
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(2, "local-dir/state-name", "state-name");
    });

    test("replace file", async () => {
        const hashDiff = new HashDiff();
        const localFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: [
                {
                    type: "file",
                    name: "path/file.txt",
                    size: 3000,
                    hash: "hash1",
                }
            ]
        };
        const serverFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: [
                {
                    type: "file",
                    name: "path/file.txt",
                    size: 1000,
                    hash: "hash2",
                }
            ]
        };
        const diffs = hashDiff.getDiffs(mockedLogger, localFiles, serverFiles, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(1);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(3000);

        const mockClient = {
            ensureDir() { },
            remove() { },
            uploadFrom() { },
        };
        const syncProvider = new FTPSyncProvider(mockClient as any, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false);
        const spyUploadFile = jest.spyOn(syncProvider, "uploadFile");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        await syncProvider.syncLocalToServer(diffs);

        expect(spyUploadFile).toHaveBeenCalledTimes(1);
        expect(spyUploadFile).toHaveBeenCalledWith("path/file.txt", "replace");

        expect(mockClientUploadFrom).toHaveBeenCalledTimes(2);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/path/file.txt", "path/file.txt");
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(2, "local-dir/state-name", "state-name");
    });

    test("remove file", async () => {
        const hashDiff = new HashDiff();
        const localFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: []
        };
        const serverFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: [
                {
                    type: "file",
                    name: "path/file.txt",
                    size: 1000,
                    hash: "hash2",
                }
            ]
        };
        const diffs = hashDiff.getDiffs(mockedLogger, localFiles, serverFiles, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(1);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(1000);
        expect(diffs.sizeReplace).toEqual(0);

        const mockClient = {
            ensureDir() { },
            remove() { },
            uploadFrom() { },
        };
        const syncProvider = new FTPSyncProvider(mockClient as any, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false);
        const spyRemoveFile = jest.spyOn(syncProvider, "removeFile");
        const mockClientRemove = jest.spyOn(mockClient, "remove");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        await syncProvider.syncLocalToServer(diffs);

        expect(spyRemoveFile).toHaveBeenCalledTimes(1);
        expect(spyRemoveFile).toHaveBeenCalledWith("path/file.txt");

        expect(mockClientRemove).toHaveBeenCalledTimes(1);
        expect(mockClientRemove).toHaveBeenNthCalledWith(1, "path/file.txt");

        expect(mockClientUploadFrom).toHaveBeenCalledTimes(1);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/state-name", "state-name");
    });

    test("remove folder", async () => {
        const hashDiff = new HashDiff();
        const localFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: []
        };
        const serverFiles: IFileList = {
            version: currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: [
                {
                    type: "folder",
                    size: undefined,
                    name: "path/folder/",
                },
                {
                    type: "folder",
                    size: undefined,
                    name: "baseFolder/",
                }
            ]
        };
        const diffs = hashDiff.getDiffs(mockedLogger, localFiles, serverFiles, true, true, true);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(2);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);

        const mockClient = {
            ensureDir() { },
            remove() { },
            removeDir() { },
            uploadFrom() { },
            cdup() { },
        };
        const syncProvider = new FTPSyncProvider(mockClient as any, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false);
        const spyRemoveFolder = jest.spyOn(syncProvider, "removeFolder");
        const mockClientRemove = jest.spyOn(mockClient, "remove");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        const mockClientRemoveDir = jest.spyOn(mockClient, "removeDir");
        await syncProvider.syncLocalToServer(diffs);

        expect(spyRemoveFolder).toHaveBeenCalledTimes(2);
        expect(spyRemoveFolder).toHaveBeenCalledWith("path/folder/");
        expect(spyRemoveFolder).toHaveBeenCalledWith("baseFolder/");

        // these paths should be absolute
        expect(mockClientRemoveDir).toHaveBeenCalledTimes(2);
        expect(mockClientRemoveDir).toHaveBeenNthCalledWith(2, "/server-dir/path/folder/");
        expect(mockClientRemoveDir).toHaveBeenNthCalledWith(1, "/server-dir/baseFolder/");

        expect(mockClientRemove).toHaveBeenCalledTimes(0);

        expect(mockClientUploadFrom).toHaveBeenCalledTimes(1);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/state-name", "state-name");
    });
});

class MockedStats implements readdirStats {
    constructor(path: string) {
        this.path = path;
        this.depth = path.split("/").length;
    }

    isFile(): boolean {
        return !this.path.endsWith("/");
    }

    isDirectory(): boolean {
        return this.path.endsWith("/");
    }

    isBlockDevice(): boolean {
        throw new Error("Method not implemented.");
    }

    isCharacterDevice(): boolean {
        throw new Error("Method not implemented.");
    }

    isSymbolicLink(): boolean {
        throw new Error("Method not implemented.");
    }

    isFIFO(): boolean {
        throw new Error("Method not implemented.");
    }

    isSocket(): boolean {
        throw new Error("Method not implemented.");
    }

    dev = 0;
    ino = 0;
    mode = 0;
    nlink = 0;
    uid = 0;
    gid = 0;
    rdev = 0;
    size = 0;
    blksize = 0;
    blocks = 0;
    atimeMs = 0;
    mtimeMs = 0;
    ctimeMs = 0;
    birthtimeMs = 0;
    atime: Date = new Date();
    mtime: Date = new Date();
    ctime: Date = new Date();
    birthtime: Date = new Date();

    path: string;
    depth: number;
}

describe("getLocalFiles", () => {
    test("local-dir", async () => {
        const localDirDiffs = await getLocalFiles({
            server: "127.0.0.1",
            username: "testUsername",
            password: "testPassword",
            port: 21,
            protocol: "ftp",
            "local-dir": "./.github/",
            "server-dir": "./",
            "state-name": ".ftp-deploy-sync-state.json",
            "dry-run": true,
            "dangerous-clean-slate": false,
            exclude: [],
            "log-level": "standard",
            security: "loose",
            timeout: 30000,
            "enable-upload": true,
            "enable-replace": true,
            "enable-delete": true,
        });

        const mainYamlDiff = localDirDiffs.data.find(diff => diff.name === "workflows/main.yml")! as IFile;
        expect(localDirDiffs.data).toEqual([
            {
                type: "folder",
                name: "workflows",
                size: undefined
            },
            {
                type: "file",
                name: "workflows/main.yml",
                size: mainYamlDiff.size,
                hash: mainYamlDiff.hash
            }
        ] as Record[]);
    });

    test("exclude node_modules", async () => {
        const files: MockedStats[] = [
            new MockedStats("test/sam"),
            new MockedStats("node_modules/"),
            new MockedStats("node_modules/test.js"),
            new MockedStats("node_modules/@samkirkland/"),
        ];

        const filteredStats = files.filter(file => applyExcludeFilter(file, excludeDefaults));

        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/sam"]);
    });

    test("exclude .git files", async () => {
        const files: MockedStats[] = [
            new MockedStats("test/sam"),
            new MockedStats(".git/"),
            new MockedStats(".gitattributes"),
            new MockedStats(".gitignore"),
            new MockedStats(".git/config"),
            new MockedStats(".github/"),
            new MockedStats(".github/workflows/main.yml"),
            new MockedStats("test/.git/workflows/main.yml"),
        ];

        const filteredStats = files.filter(file => applyExcludeFilter(file, excludeDefaults));

        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/sam"]);
    });

    test("exclude none", async () => {
        const files: MockedStats[] = [
            new MockedStats("test/sam"),
            new MockedStats("test/folder/"),
            new MockedStats(".gitattributes"),
            new MockedStats(".gitignore"),
            new MockedStats(".git/config"),
            new MockedStats(".github/"),
            new MockedStats(".github/workflows/main.yml"),
            new MockedStats("test/.git/workflows/main.yml"),
            new MockedStats("node_modules/"),
            new MockedStats("node_modules/test.js"),
            new MockedStats("node_modules/@samkirkland/"),
        ];

        const filteredStats = files.filter(file => applyExcludeFilter(file, []));

        expect(filteredStats.length).toBe(11);
    });

    test("exclude all js files", async () => {
        const files: MockedStats[] = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
        ];

        const filteredStats = files.filter(file => applyExcludeFilter(file, ["*.js"]));

        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/folder/"]);
    });

    test("exclude globbed folder", async () => {
        const files: MockedStats[] = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
        ];

        const filteredStats = files.filter(file => applyExcludeFilter(file, ["**/folder/**"]));

        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/test.js"]);
    });

    test("exclude existing folder", async () => {
        const files: MockedStats[] = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
        ];

        const filteredStats = files.filter(file => applyExcludeFilter(file, ["**/folder/**"]));

        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/test.js"]);
    });

    test("exclude existing folder while adding new file", async () => {
        const files: MockedStats[] = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
            new MockedStats("test/folder/newfile.js"),
        ];

        const filteredStats = files.filter(file => applyExcludeFilter(file, ["test/folder/**"]));

        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/test.js"]);
    });
});


describe("getDefaultSettings", () => {
    test("path validation", async () => {
        expect(() => getDefaultSettings({
            server: "a",
            username: "b",
            password: "c",
            "local-dir": "noEndingSlash"
        })).toThrowError("local-dir should be a folder (must end with /)");

        expect(() => getDefaultSettings({
            server: "a",
            username: "b",
            password: "c",
            "server-dir": "noEndingSlash"
        })).toThrowError("server-dir should be a folder (must end with /)");
    });

    test("verify default settings", async () => {
        expect(getDefaultSettings({
            server: "a",
            username: "b",
            password: "c",
        })).toEqual({
            server: "a",
            username: "b",
            password: "c",
            port: 21,
            protocol: "ftp",
            "local-dir": "./",
            "server-dir": "./",
            "state-name": ".ftp-deploy-sync-state.json",
            "dry-run": false,
            "dangerous-clean-slate": false,
            exclude: excludeDefaults,
            "log-level": "standard",
            security: "loose",
            timeout: 30000,
            "enable-upload": true,
            "enable-replace": true,
            "enable-delete": true
        });
    });

    test("verify default settings override", async () => {
        const customSettings: IFtpDeployArgumentsWithDefaults = {
            server: "a",
            username: "b",
            password: "c",
            port: 54321,
            protocol: "ftps-legacy",
            "local-dir": "./client/",
            "server-dir": "./server/",
            "state-name": ".customState.json",
            "dry-run": true,
            "dangerous-clean-slate": true,
            exclude: [],
            "log-level": "verbose",
            security: "strict",
            timeout: 1234,
            "enable-upload": true,
            "enable-replace": true,
            "enable-delete": true
        };

        expect(getDefaultSettings(customSettings)).toEqual(customSettings);
    });
});

describe("error handling", () => {
    test("throws on error", async () => {
        const mockedLogger = new MockedLogger();
        const mockedTimings = new Timings();

        const argsWithDefaults = getDefaultSettings({
            server: "127.0.0.1",
            username: "testUsername",
            password: "testPassword",
            port: 21,
            protocol: "ftp",
            "local-dir": "./",
            "dry-run": true,
            "log-level": "minimal"
        });

        await expect(async () => await deploy(argsWithDefaults, mockedLogger, mockedTimings)).rejects.toThrow();
    });
});

describe("dry-run", () => {
    test("getServerFiles doesn't mutate server", async () => {
        const mockedLogger = new MockedLogger();
        const mockedTimings = new Timings();
        const mockClient = {
            clearWorkingDir() { },
            ensureDir() { },
        };
        const settings = getDefaultSettings({
            server: "a",
            username: "b",
            password: "c",
            "dry-run": true,
            "dangerous-clean-slate": true,
        });

        const spyClearWorkingDir = jest.spyOn(mockClient, "clearWorkingDir");
        await getServerFiles(mockClient as any, mockedLogger, mockedTimings, settings);

        expect(spyClearWorkingDir).toHaveBeenCalledTimes(0);
    });

    test("doesn't mutate server", async () => {
        const mockedLogger = new MockedLogger();
        const mockedTimings = new Timings();
        const mockClient = {
            uploadFile() { },
            removeFile() { },
            uploadFrom() { },
            remove() { },
        };
        const mockedDiffs: DiffResult = {
            upload: [
                {
                    type: "file",
                    name: "path/upload.txt",
                    size: 1000,
                    hash: "hash2",
                }
            ],
            delete: [
                {
                    type: "file",
                    name: "path/delete.txt",
                    size: 1000,
                    hash: "hash2",
                }
            ],
            replace: [
                {
                    type: "file",
                    name: "path/replace.txt",
                    size: 1000,
                    hash: "hash2",
                }
            ],
            same: [
                {
                    type: "file",
                    name: "path/same.txt",
                    size: 1000,
                    hash: "hash2",
                }
            ],
            sizeUpload: 1000,
            sizeDelete: 1000,
            sizeReplace: 1000,
        };

        // todo ensureDir

        const syncProvider = new FTPSyncProvider(mockClient as any, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", true);
        const spyUploadFile = jest.spyOn(mockClient, "uploadFile");
        const spyRemoveFile = jest.spyOn(mockClient, "removeFile");
        const spyUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        const spyRemove = jest.spyOn(mockClient, "remove");
        await syncProvider.syncLocalToServer(mockedDiffs);

        expect(spyUploadFile).toHaveBeenCalledTimes(0);
        expect(spyRemoveFile).toHaveBeenCalledTimes(0);
        expect(spyUploadFrom).toHaveBeenCalledTimes(0);
        expect(spyRemove).toHaveBeenCalledTimes(0);
    });
});

describe("Deploy", () => {
    const port = 2121;
    const homeDir = path.join(__dirname, "../");

    let ftpServer: FtpSrv;

    beforeEach(() => {
        ftpServer = new FtpSrv({
            anonymous: true,
            pasv_url: "127.0.0.1",
            url: `ftp://127.0.0.1:${port}`,
            tls: false,
            blacklist: [],
            whitelist: []
        });

        ftpServer.on("login", (data, resolve) => {
            resolve({ root: homeDir });
        });
    });

    afterEach(async () => {
        if (ftpServer) {
            await ftpServer.close();
        }
    });

    test("Full Deploy", async () => {
        const mockedLogger = new MockedLogger();
        const mockedTimings = new Timings();
        ftpServer.listen();

        const argsWithDefaults = getDefaultSettings({
            server: "127.0.0.1",
            username: "testUsername",
            password: "testPassword",
            port: port,
            protocol: "ftp",
            "local-dir": "./",
            "dry-run": true,
            "log-level": "minimal"
        });

        await deploy(argsWithDefaults, mockedLogger, mockedTimings);
    });

    test("Deploy with enableUpload=false verifies no upload calls", async () => {
        // Create test data that would normally trigger uploads
        const localFiles = createTestFileList([
            {name: "new-file.txt", size: 1000, hash: "hash1"},
            {name: "another-file.txt", size: 500, hash: "hash2"},
            {name: "folder/", size: 0, hash: "", type: "folder"},
            {name: "folder/nested-file.txt", size: 300, hash: "hash3"}
        ]);
        
        const serverFiles = createTestFileList([]); // Empty server = would normally trigger uploads

        // Test with enableUpload=false - should not call uploadFile for any uploads
        const result = await testEnableOption(
            localFiles, 
            serverFiles, 
            false, // enableUpload=false
            true,  // enableReplace=true 
            true,  // enableDelete=true
            {
                // No upload calls expected since enableUpload=false
                uploadFile: [],
                removeFile: [],
                removeFolder: [],
                createFolder: []
            }
        );

        // Verify no uploads are planned when enableUpload=false
        expect(result.diffs.upload.length).toEqual(0);
        expect(result.diffs.sizeUpload).toEqual(0);
    });

    test("Deploy with enableDelete=false verifies no delete calls", async () => {
        // Create test data that would normally trigger deletes
        const localFiles = createTestFileList([
            {name: "kept-file.txt", size: 1000, hash: "hash1"}
        ]);
        
        const serverFiles = createTestFileList([
            {name: "kept-file.txt", size: 1000, hash: "hash1"}, // Same file, should remain
            {name: "delete-me.txt", size: 500, hash: "hash2"},   // Should be deleted if enabled
            {name: "old-folder/", size: 0, hash: "", type: "folder"}, // Should be deleted if enabled
            {name: "old-folder/old-file.txt", size: 300, hash: "hash3"} // Should be deleted if enabled
        ]);

        // Test with enableDelete=false - should not call removeFile or removeFolder
        const result = await testEnableOption(
            localFiles, 
            serverFiles, 
            true,  // enableUpload=true
            true,  // enableReplace=true 
            false, // enableDelete=false
            {
                uploadFile: [],
                removeFile: [], // No delete calls expected since enableDelete=false
                removeFolder: [], // No delete calls expected since enableDelete=false
                createFolder: []
            }
        );

        // Verify no deletes are planned when enableDelete=false
        expect(result.diffs.delete.length).toEqual(0);
        expect(result.diffs.sizeDelete).toEqual(0);
    });

    test("Deploy with enableReplace=false verifies no replace calls", async () => {
        // Create test data that would normally trigger replaces
        const localFiles = createTestFileList([
            {name: "same-file.txt", size: 1000, hash: "hash1"},      // Same hash, no replace needed
            {name: "changed-file.txt", size: 1000, hash: "newHash"}, // Different hash, would replace if enabled
            {name: "another-changed.txt", size: 500, hash: "newHash2"} // Different hash, would replace if enabled
        ]);
        
        const serverFiles = createTestFileList([
            {name: "same-file.txt", size: 1000, hash: "hash1"},      // Same hash
            {name: "changed-file.txt", size: 1000, hash: "oldHash"}, // Different hash
            {name: "another-changed.txt", size: 500, hash: "oldHash2"} // Different hash
        ]);

        // Test with enableReplace=false - should not call uploadFile with "replace"
        const result = await testEnableOption(
            localFiles, 
            serverFiles, 
            true,  // enableUpload=true
            false, // enableReplace=false
            true,  // enableDelete=true
            {
                uploadFile: [], // No replace calls expected since enableReplace=false
                removeFile: [],
                removeFolder: [],
                createFolder: []
            }
        );

        // Verify no replaces are planned when enableReplace=false
        expect(result.diffs.replace.length).toEqual(0);
        expect(result.diffs.sizeReplace).toEqual(0);
        
        // But same files should still be tracked
        expect(result.diffs.same.length).toEqual(1);
        expect(result.diffs.same[0].name).toEqual("same-file.txt");
    });

    test("Deploy with all enable options disabled verifies no operation calls", async () => {
        // Create comprehensive test data that would normally trigger all operations
        const localFiles = createTestFileList([
            {name: "same-file.txt", size: 1000, hash: "hash1"},      // Same hash, no operation needed
            {name: "new-file.txt", size: 500, hash: "hash2"},        // Would upload if enabled
            {name: "changed-file.txt", size: 800, hash: "newHash"}   // Would replace if enabled
        ]);
        
        const serverFiles = createTestFileList([
            {name: "same-file.txt", size: 1000, hash: "hash1"},      // Same hash
            {name: "changed-file.txt", size: 800, hash: "oldHash"},  // Different hash
            {name: "delete-me.txt", size: 300, hash: "hash3"},       // Would delete if enabled
            {name: "old-folder/", size: 0, hash: "", type: "folder"} // Would delete if enabled
        ]);

        // Test with all options disabled - should not call any operation methods
        const result = await testEnableOption(
            localFiles, 
            serverFiles, 
            false, // enableUpload=false
            false, // enableReplace=false
            false, // enableDelete=false
            {
                uploadFile: [],   // No operations expected
                removeFile: [],   // No operations expected
                removeFolder: [], // No operations expected
                createFolder: []  // No operations expected
            }
        );

        // Verify no operations are planned when all options are disabled
        expect(result.diffs.upload.length).toEqual(0);
        expect(result.diffs.replace.length).toEqual(0);
        expect(result.diffs.delete.length).toEqual(0);
        expect(result.diffs.sizeUpload).toEqual(0);
        expect(result.diffs.sizeReplace).toEqual(0);
        expect(result.diffs.sizeDelete).toEqual(0);
        
        // Only same files should be tracked
        expect(result.diffs.same.length).toEqual(1);
        expect(result.diffs.same[0].name).toEqual("same-file.txt");
    });

    test("Deploy with all enable options enabled verifies correct operation calls", async () => {
        // Create comprehensive test data that triggers all operations
        const localFiles = createTestFileList([
            {name: "same-file.txt", size: 1000, hash: "hash1"},      // Same hash, no operation needed
            {name: "new-file.txt", size: 500, hash: "hash2"},        // Should upload
            {name: "new-folder/", size: 0, hash: "", type: "folder"}, // Should create folder
            {name: "new-folder/nested-file.txt", size: 200, hash: "hash4"}, // Should upload
            {name: "changed-file.txt", size: 800, hash: "newHash"}   // Should replace
        ]);
        
        const serverFiles = createTestFileList([
            {name: "same-file.txt", size: 1000, hash: "hash1"},      // Same hash
            {name: "changed-file.txt", size: 800, hash: "oldHash"},  // Different hash
            {name: "delete-me.txt", size: 300, hash: "hash3"},       // Should delete
            {name: "old-folder/", size: 0, hash: "", type: "folder"} // Should delete
        ]);

        // Test with all options enabled - should call appropriate operation methods
        const result = await testEnableOption(
            localFiles, 
            serverFiles, 
            true, // enableUpload=true
            true, // enableReplace=true
            true, // enableDelete=true
            {
                uploadFile: [
                    {file: "new-file.txt", type: "upload"},
                    {file: "new-folder/nested-file.txt", type: "upload"},
                    {file: "changed-file.txt", type: "replace"}
                ],
                removeFile: ["delete-me.txt"],
                removeFolder: ["old-folder/"],
                createFolder: ["new-folder/"]
            }
        );

        // Verify operations are planned correctly when all options are enabled
        expect(result.diffs.upload.length).toEqual(3); // 2 files + 1 folder
        expect(result.diffs.replace.length).toEqual(1);
        expect(result.diffs.delete.length).toEqual(2); // 1 file + 1 folder
        expect(result.diffs.same.length).toEqual(1);
    });

});