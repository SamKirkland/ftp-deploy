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
    test("Should call again when exception thrown", async () => {
        let callCount = 0;
        async function method() {
            callCount++;
            if (callCount <= 1) {
                throw {
                    code: ErrorCode.FileActionNotTaken
                };
            }

            return "test";
        }

        const logger = new MockedLogger();

        const result = await retryRequest(logger, method);
        expect(result).toBe("test");
    });
});
