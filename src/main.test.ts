import { HashDiff } from "./HashDiff";
import { IFileList, currentVersion } from "./types";
import { Record } from "./types";
import { ILogger } from "./utilities";
import path from "path";
import FtpSrv from "ftp-srv";
import { deploy } from "./module";
import { Timer } from "./utilities";

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
    warn() { };
    info() { };
    debug() { };
}

describe("HashDiff", () => {
    const thing = new HashDiff();
    const emptyFileList: IFileList = { version: currentVersion, description: "", generatedTime: new Date().getTime(), data: [] };
    const minimalFileList: IFileList = { version: currentVersion, description: "", generatedTime: new Date().getTime(), data: tenFiles };

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


describe("Utilities", () => {
    test("Start and stop timer", () => {
        const time = new Timer();

        time.start();
        time.stop();

        expect(time.time).not.toBeNull();
    });

    test("Start and stop timer multiple times", async () => {
        const time = new Timer();

        time.start();
        await new Promise(resolve => setTimeout(resolve, 10));
        time.stop();

        const firstTime = time.time;

        time.start();
        await new Promise(resolve => setTimeout(resolve, 10));
        time.stop();

        const secondTime = time.time;

        expect(firstTime).not.toEqual(secondTime);
    });

    test("Errors when stop without start", () => {
        const time = new Timer();

        expect(() => time.stop()).toThrowError("Called .stop() before calling .start()");
    });
});


describe("Deploy", () => {
    const port = 2121;
    const homeDir = path.join(__dirname, "../ftpServer/");

    const ftpServer = new FtpSrv({
        anonymous: true,
        pasv_url: "127.0.0.1",
        url: `ftp://127.0.0.1:${port}`
    });

    ftpServer.on("login", (data, resolve) => {
        console.log("[login] Connection by", data.username);
        console.log("[login] Setting home dir to:", homeDir);
        resolve({ root: homeDir });
    });

    ftpServer.on("client-error", ({ context, error }) => {
        console.log("**client-error**");
        console.log(context);
        console.log(error);
    });

    ftpServer.on("error" as any, err => {
        console.log("**error**");
        console.log(err);
    });

    ftpServer.on("uncaughtException" as any, err => {
        console.log("**uncaughtException**");
        console.log(err);
    });

    /*
    test("should connect", async () => {
        ftpServer
            .listen()
            .then(() => {
                console.log(`Serving ${homeDir} on port: ${port}`);
            });

        await deploy({
            "server": "127.0.0.1",
            "username": "testUsername",
            "password": "testPassword",
            "port": port,
            "local-dir": "src/"
        });
    });
    */
});
