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

describe("HashDiff", () => {
    const thing = new HashDiff();
    const emptyFileList: IFileList = { version: currentSyncFileVersion, description: "", generatedTime: new Date().getTime(), data: [] };
    const minimalFileList: IFileList = { version: currentSyncFileVersion, description: "", generatedTime: new Date().getTime(), data: tenFiles };

    test("Empty Client, Empty Server", () => {
        const diffs = thing.getDiffs(emptyFileList, emptyFileList);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Empty Server", () => {
        const diffs = thing.getDiffs(minimalFileList, emptyFileList);

        expect(diffs.upload.length).toEqual(10);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(10000);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Empty Client, Minimal Server", () => {
        const diffs = thing.getDiffs(emptyFileList, minimalFileList);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(10);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(10000);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Minimal Server - No Diffs", () => {
        const diffs = thing.getDiffs(minimalFileList, minimalFileList);

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
        const diffs = thing.getDiffs(minimalFileList2, minimalFileList);

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
        const diffs = thing.getDiffs(minimalFileList, minimalFileList2);

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

        const diffs = thing.getDiffs(clientState, serverState);

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(1);
        expect(diffs.delete).toStrictEqual([{ type: "folder", name: "folder/subFolder/", size: undefined }]);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(1000);
        expect(diffs.sizeReplace).toEqual(0);
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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles);

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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles);

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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles);

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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles);

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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles);

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
            timeout: 30000
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
            timeout: 1234
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
    }, 30000);
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

    const ftpServer = new FtpSrv({
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

        ftpServer.close();
    }, 30000);
});