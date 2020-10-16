import path from "path";
import FtpSrv from "ftp-srv";
// import { deploy } from "./module";
import { ILogger, retryRequest, Timer } from "./utilities";
import { ErrorCode } from "./types";

class MockedLogger implements ILogger {
    all() { };
    standard() { };
    verbose() { };
}

describe("Timer", () => {
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

describe("Retry Util", () => {
    test("Should call again when exception throw", async () => {
        let callCount = 0;
        async function method() {
            if (callCount === 0) {
                throw {
                    error: ErrorCode.FileActionNotTaken
                };
            }

            callCount++;

            return "test";
        }

        const logger = new MockedLogger();

        retryRequest(logger, async () => await method());
    });

    test("Should throw on second exception", async () => {
        async function method() {
            throw {
                error: ErrorCode.FileActionNotTaken
            };
        }

        const logger = new MockedLogger();

        expect(async () => await retryRequest(logger, async () => await method())).toThrowError("Error here");
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
});
