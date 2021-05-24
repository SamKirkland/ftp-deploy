import { HashDiff } from "./HashDiff";
import { IFileList, currentSyncFileVersion } from "./types";
import { Record } from "./types";
import { getDefaultSettings, ILogger, Timings } from "./utilities";
import path from "path";
import FtpSrv from "ftp-srv";
import { deploy } from "./module";
import { getLocalFiles } from "./localFiles";
import { FTPSyncProvider } from "./syncProvider";

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
        const diffs = thing.getDiffs(emptyFileList, emptyFileList, new MockedLogger());

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Empty Server", () => {
        const diffs = thing.getDiffs(minimalFileList, emptyFileList, new MockedLogger());

        expect(diffs.upload.length).toEqual(10);
        expect(diffs.delete.length).toEqual(0);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(10000);
        expect(diffs.sizeDelete).toEqual(0);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Empty Client, Minimal Server", () => {
        const diffs = thing.getDiffs(emptyFileList, minimalFileList, new MockedLogger());

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(10);
        expect(diffs.replace.length).toEqual(0);

        expect(diffs.sizeUpload).toEqual(0);
        expect(diffs.sizeDelete).toEqual(10000);
        expect(diffs.sizeReplace).toEqual(0);
    });

    test("Minimal Client, Minimal Server - No Diffs", () => {
        const diffs = thing.getDiffs(minimalFileList, minimalFileList, new MockedLogger());

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
        const diffs = thing.getDiffs(minimalFileList2, minimalFileList, new MockedLogger());

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
        const diffs = thing.getDiffs(minimalFileList, minimalFileList2, new MockedLogger());

        expect(diffs.upload.length).toEqual(0);
        expect(diffs.delete.length).toEqual(1);
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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles, mockedLogger);

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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles, mockedLogger);

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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles, mockedLogger);

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
        const diffs = hashDiff.getDiffs(localFiles, serverFiles, mockedLogger);

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
});

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
        });

        expect(localDirDiffs.data).toEqual([
            {
                type: "folder",
                name: "workflows",
                size: undefined
            },
            {
                type: "file",
                name: "workflows/main.yml",
                size: 410,
                hash: "356464bef208ba0862c358f06d087b20f2b1073809858dd9c69fc2bc2894619f"
            }
        ] as Record[]);
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