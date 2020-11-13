import { HashDiff } from "./HashDiff";
import { IFileList, currentSyncFileVersion } from "./types";
import { Record } from "./types";
import { ILogger } from "./utilities";
import path from "path";
import FtpSrv from "ftp-srv";
import { deploy, getLocalFiles } from "./module";

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
        await expect(async () => await deploy({
            server: "127.0.0.1",
            username: "testUsername",
            password: "testPassword",
            port: 21,
            protocol: "ftp",
            "local-dir": "./",
            "dry-run": true,
            "log-level": "minimal"
        })).rejects.toThrow();
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
        ftpServer.listen();

        await deploy({
            server: "127.0.0.1",
            username: "testUsername",
            password: "testPassword",
            port: port,
            protocol: "ftp",
            "local-dir": "./",
            "dry-run": true,
            "log-level": "minimal"
        });

        ftpServer.close();
    }, 30000);
});