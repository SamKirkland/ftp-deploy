import { HashDiff } from "./HashDiff";
import { IFileList } from "./types";
import { Record } from "./types";
import { Logger, ILogger } from "./utilities";

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
    all(...data: any[]) { };
    warn(...data: any[]) { };
    info(...data: any[]) { };
    debug(...data: any[]) { };
}

describe("HashDiff", () => {
    const thing = new HashDiff();
    const emptyFileList: IFileList = { version: "1.0.0", description: "", generatedTime: new Date().getTime(), data: [] };
    const minimalFileList: IFileList = { version: "1.0.0", description: "", generatedTime: new Date().getTime(), data: tenFiles };

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
