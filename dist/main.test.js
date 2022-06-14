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
const HashDiff_1 = require("./HashDiff");
const types_1 = require("./types");
const utilities_1 = require("./utilities");
const path_1 = __importDefault(require("path"));
const ftp_srv_1 = __importDefault(require("ftp-srv"));
const localFiles_1 = require("./localFiles");
const syncProvider_1 = require("./syncProvider");
const deploy_1 = require("./deploy");
const module_1 = require("./module");
const tenFiles = [
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
class MockedLogger {
    all() { }
    ;
    standard() { }
    ;
    verbose() { }
    ;
}
describe("HashDiff", () => {
    const thing = new HashDiff_1.HashDiff();
    const emptyFileList = { version: types_1.currentSyncFileVersion, description: "", generatedTime: new Date().getTime(), data: [] };
    const minimalFileList = { version: types_1.currentSyncFileVersion, description: "", generatedTime: new Date().getTime(), data: tenFiles };
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
        const minimalFileList2 = Object.assign(Object.assign({}, minimalFileList), { data: [
                ...minimalFileList.data,
                {
                    type: "file",
                    name: "zzzz",
                    size: 1000,
                    hash: "hash",
                }
            ] });
        const diffs = thing.getDiffs(minimalFileList2, minimalFileList);
        expect(diffs.upload.length).toEqual(1);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);
        expect(diffs.sizeUpload).toEqual(1000);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });
    test("Minimal Client, Minimal Server 2", () => {
        const minimalFileList2 = Object.assign(Object.assign({}, minimalFileList), { data: [
                ...minimalFileList.data,
                {
                    type: "file",
                    name: "zzzz",
                    size: 1000,
                    hash: "hash",
                }
            ] });
        const diffs = thing.getDiffs(minimalFileList, minimalFileList2);
        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(1);
        expect(diffs.replace.length).toEqual(0);
        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(1000);
        expect(diffs.sizeReplace).toEqual(0);
    });
    test("Delete folder with nested content", () => {
        const clientState = Object.assign(Object.assign({}, emptyFileList), { data: [
                {
                    type: "folder",
                    name: "folder/",
                    size: undefined,
                }
            ] });
        const serverState = Object.assign(Object.assign({}, emptyFileList), { data: [
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
            ] });
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
    const mockedTimings = new utilities_1.Timings();
    test("upload file", () => __awaiter(void 0, void 0, void 0, function* () {
        const hashDiff = new HashDiff_1.HashDiff();
        const localFiles = {
            version: types_1.currentSyncFileVersion,
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
        const serverFiles = {
            version: types_1.currentSyncFileVersion,
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
        const syncProvider = new syncProvider_1.FTPSyncProvider(mockClient, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false, false);
        const spyRemoveFile = jest.spyOn(syncProvider, "uploadFile");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        yield syncProvider.syncLocalToServer(diffs);
        expect(spyRemoveFile).toHaveBeenCalledTimes(1);
        expect(spyRemoveFile).toHaveBeenCalledWith("path/file.txt", "upload");
        expect(mockClientUploadFrom).toHaveBeenCalledTimes(2);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/path/file.txt", "path/file.txt");
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(2, "local-dir/state-name", "state-name");
    }));
    test("rename file", () => __awaiter(void 0, void 0, void 0, function* () {
        const hashDiff = new HashDiff_1.HashDiff();
        const localFiles = {
            version: types_1.currentSyncFileVersion,
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
        const serverFiles = {
            version: types_1.currentSyncFileVersion,
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
        const syncProvider = new syncProvider_1.FTPSyncProvider(mockClient, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false, false);
        const spyUploadFile = jest.spyOn(syncProvider, "uploadFile");
        const spyRemoveFile = jest.spyOn(syncProvider, "removeFile");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        const mockClientRemove = jest.spyOn(mockClient, "remove");
        yield syncProvider.syncLocalToServer(diffs);
        expect(spyRemoveFile).toHaveBeenCalledTimes(1);
        expect(spyRemoveFile).toHaveBeenCalledWith("path/oldFile.txt");
        expect(spyUploadFile).toHaveBeenCalledTimes(1);
        expect(spyUploadFile).toHaveBeenCalledWith("path/newName.txt", "upload");
        expect(mockClientRemove).toHaveBeenCalledTimes(1);
        expect(mockClientRemove).toHaveBeenNthCalledWith(1, "path/oldFile.txt");
        expect(mockClientUploadFrom).toHaveBeenCalledTimes(2);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/path/newName.txt", "path/newName.txt");
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(2, "local-dir/state-name", "state-name");
    }));
    test("replace file", () => __awaiter(void 0, void 0, void 0, function* () {
        const hashDiff = new HashDiff_1.HashDiff();
        const localFiles = {
            version: types_1.currentSyncFileVersion,
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
        const serverFiles = {
            version: types_1.currentSyncFileVersion,
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
        const syncProvider = new syncProvider_1.FTPSyncProvider(mockClient, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false, false);
        const spyUploadFile = jest.spyOn(syncProvider, "uploadFile");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        yield syncProvider.syncLocalToServer(diffs);
        expect(spyUploadFile).toHaveBeenCalledTimes(1);
        expect(spyUploadFile).toHaveBeenCalledWith("path/file.txt", "replace");
        expect(mockClientUploadFrom).toHaveBeenCalledTimes(2);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/path/file.txt", "path/file.txt");
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(2, "local-dir/state-name", "state-name");
    }));
    test("remove file", () => __awaiter(void 0, void 0, void 0, function* () {
        const hashDiff = new HashDiff_1.HashDiff();
        const localFiles = {
            version: types_1.currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: []
        };
        const serverFiles = {
            version: types_1.currentSyncFileVersion,
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
        const syncProvider = new syncProvider_1.FTPSyncProvider(mockClient, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false, false);
        const spyRemoveFile = jest.spyOn(syncProvider, "removeFile");
        const mockClientRemove = jest.spyOn(mockClient, "remove");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        yield syncProvider.syncLocalToServer(diffs);
        expect(spyRemoveFile).toHaveBeenCalledTimes(1);
        expect(spyRemoveFile).toHaveBeenCalledWith("path/file.txt");
        expect(mockClientRemove).toHaveBeenCalledTimes(1);
        expect(mockClientRemove).toHaveBeenNthCalledWith(1, "path/file.txt");
        expect(mockClientUploadFrom).toHaveBeenCalledTimes(1);
        expect(mockClientUploadFrom).toHaveBeenNthCalledWith(1, "local-dir/state-name", "state-name");
    }));
    test("remove folder", () => __awaiter(void 0, void 0, void 0, function* () {
        const hashDiff = new HashDiff_1.HashDiff();
        const localFiles = {
            version: types_1.currentSyncFileVersion,
            description: "",
            generatedTime: new Date().getTime(),
            data: []
        };
        const serverFiles = {
            version: types_1.currentSyncFileVersion,
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
        const syncProvider = new syncProvider_1.FTPSyncProvider(mockClient, mockedLogger, mockedTimings, "local-dir/", "server-dir/", "state-name", false, false);
        const spyRemoveFolder = jest.spyOn(syncProvider, "removeFolder");
        const mockClientRemove = jest.spyOn(mockClient, "remove");
        const mockClientUploadFrom = jest.spyOn(mockClient, "uploadFrom");
        const mockClientRemoveDir = jest.spyOn(mockClient, "removeDir");
        yield syncProvider.syncLocalToServer(diffs);
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
    }));
});
class MockedStats {
    constructor(path) {
        this.dev = 0;
        this.ino = 0;
        this.mode = 0;
        this.nlink = 0;
        this.uid = 0;
        this.gid = 0;
        this.rdev = 0;
        this.size = 0;
        this.blksize = 0;
        this.blocks = 0;
        this.atimeMs = 0;
        this.mtimeMs = 0;
        this.ctimeMs = 0;
        this.birthtimeMs = 0;
        this.atime = new Date();
        this.mtime = new Date();
        this.ctime = new Date();
        this.birthtime = new Date();
        this.path = path;
        this.depth = path.split("/").length;
    }
    isFile() {
        return !this.path.endsWith("/");
    }
    isDirectory() {
        return this.path.endsWith("/");
    }
    isBlockDevice() {
        throw new Error("Method not implemented.");
    }
    isCharacterDevice() {
        throw new Error("Method not implemented.");
    }
    isSymbolicLink() {
        throw new Error("Method not implemented.");
    }
    isFIFO() {
        throw new Error("Method not implemented.");
    }
    isSocket() {
        throw new Error("Method not implemented.");
    }
}
describe("getLocalFiles", () => {
    test("local-dir", () => __awaiter(void 0, void 0, void 0, function* () {
        const localDirDiffs = yield localFiles_1.getLocalFiles({
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
            "sync-posix-modes": true,
        });
        const mainYamlDiff = localDirDiffs.data.find(diff => diff.name === "workflows/main.yml");
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
        ]);
    }));
    test("exclude node_modules", () => __awaiter(void 0, void 0, void 0, function* () {
        const files = [
            new MockedStats("test/sam"),
            new MockedStats("node_modules/"),
            new MockedStats("node_modules/test.js"),
            new MockedStats("node_modules/@samkirkland/"),
        ];
        const filteredStats = files.filter(file => utilities_1.applyExcludeFilter(file, module_1.excludeDefaults));
        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/sam"]);
    }));
    test("exclude .git files", () => __awaiter(void 0, void 0, void 0, function* () {
        const files = [
            new MockedStats("test/sam"),
            new MockedStats(".git/"),
            new MockedStats(".gitattributes"),
            new MockedStats(".gitignore"),
            new MockedStats(".git/config"),
            new MockedStats(".github/"),
            new MockedStats(".github/workflows/main.yml"),
            new MockedStats("test/.git/workflows/main.yml"),
        ];
        const filteredStats = files.filter(file => utilities_1.applyExcludeFilter(file, module_1.excludeDefaults));
        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/sam"]);
    }));
    test("exclude none", () => __awaiter(void 0, void 0, void 0, function* () {
        const files = [
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
        const filteredStats = files.filter(file => utilities_1.applyExcludeFilter(file, []));
        expect(filteredStats.length).toBe(11);
    }));
    test("exclude all js files", () => __awaiter(void 0, void 0, void 0, function* () {
        const files = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
        ];
        const filteredStats = files.filter(file => utilities_1.applyExcludeFilter(file, ["*.js"]));
        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/folder/"]);
    }));
    test("exclude globbed folder", () => __awaiter(void 0, void 0, void 0, function* () {
        const files = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
        ];
        const filteredStats = files.filter(file => utilities_1.applyExcludeFilter(file, ["**/folder/**"]));
        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/test.js"]);
    }));
    test("exclude existing folder", () => __awaiter(void 0, void 0, void 0, function* () {
        const files = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
        ];
        const filteredStats = files.filter(file => utilities_1.applyExcludeFilter(file, ["**/folder/**"]));
        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/test.js"]);
    }));
    test("exclude existing folder while adding new file", () => __awaiter(void 0, void 0, void 0, function* () {
        const files = [
            new MockedStats("test/test.js"),
            new MockedStats("test/folder/"),
            new MockedStats("test/folder/newfile.js"),
        ];
        const filteredStats = files.filter(file => utilities_1.applyExcludeFilter(file, ["test/folder/**"]));
        expect(filteredStats.map(f => f.path)).toStrictEqual(["test/test.js"]);
    }));
});
describe("error handling", () => {
    test("throws on error", () => __awaiter(void 0, void 0, void 0, function* () {
        const mockedLogger = new MockedLogger();
        const mockedTimings = new utilities_1.Timings();
        const argsWithDefaults = utilities_1.getDefaultSettings({
            server: "127.0.0.1",
            username: "testUsername",
            password: "testPassword",
            port: 21,
            protocol: "ftp",
            "local-dir": "./",
            "dry-run": true,
            "log-level": "minimal"
        });
        yield expect(() => __awaiter(void 0, void 0, void 0, function* () { return yield deploy_1.deploy(argsWithDefaults, mockedLogger, mockedTimings); })).rejects.toThrow();
    }), 30000);
});
describe("Deploy", () => {
    const port = 2121;
    const homeDir = path_1.default.join(__dirname, "../");
    const ftpServer = new ftp_srv_1.default({
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
    test("Full Deploy", () => __awaiter(void 0, void 0, void 0, function* () {
        const mockedLogger = new MockedLogger();
        const mockedTimings = new utilities_1.Timings();
        ftpServer.listen();
        const argsWithDefaults = utilities_1.getDefaultSettings({
            server: "127.0.0.1",
            username: "testUsername",
            password: "testPassword",
            port: port,
            protocol: "ftp",
            "local-dir": "./",
            "dry-run": true,
            "log-level": "minimal"
        });
        yield deploy_1.deploy(argsWithDefaults, mockedLogger, mockedTimings);
        ftpServer.close();
    }), 30000);
});
