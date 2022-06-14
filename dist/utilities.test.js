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
Object.defineProperty(exports, "__esModule", { value: true });
const utilities_1 = require("./utilities");
const types_1 = require("./types");
class MockedLogger {
    all() { }
    ;
    standard() { }
    ;
    verbose() { }
    ;
}
describe("Timer", () => {
    test("Start and stop timer", () => {
        const time = new utilities_1.Timer();
        time.start();
        time.stop();
        expect(time.time).not.toBeNull();
    });
    test("Start and stop timer multiple times", () => __awaiter(void 0, void 0, void 0, function* () {
        const time = new utilities_1.Timer();
        time.start();
        yield new Promise(resolve => setTimeout(resolve, 10));
        time.stop();
        const firstTime = time.time;
        time.start();
        yield new Promise(resolve => setTimeout(resolve, 10));
        time.stop();
        const secondTime = time.time;
        expect(firstTime).not.toEqual(secondTime);
    }));
    test("Errors when stop without start", () => {
        const time = new utilities_1.Timer();
        expect(() => time.stop()).toThrowError("Called .stop() before calling .start()");
    });
});
describe("Retry Util", () => {
    test("Should call again when exception thrown", () => __awaiter(void 0, void 0, void 0, function* () {
        let callCount = 0;
        function method() {
            return __awaiter(this, void 0, void 0, function* () {
                callCount++;
                if (callCount <= 1) {
                    throw {
                        code: types_1.ErrorCode.FileActionNotTaken
                    };
                }
                return "test";
            });
        }
        const logger = new MockedLogger();
        const result = yield utilities_1.retryRequest(logger, method);
        expect(result).toBe("test");
    }));
});
