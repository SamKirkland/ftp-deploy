"use strict";
// modified version of https://github.com/jergason/recursive-readdir
// to add folder list support
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recursive = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const minimatch_1 = __importDefault(require("minimatch"));
function patternMatcher(pattern) {
    return function (path, stats) {
        var minimatcher = new minimatch_1.default.Minimatch(pattern, { matchBase: true });
        return (!minimatcher.negate || stats.isFile()) && minimatcher.match(path);
    };
}
function toMatcherFunction(ignoreEntry) {
    if (typeof ignoreEntry == "function") {
        return ignoreEntry;
    }
    else {
        return patternMatcher(ignoreEntry);
    }
}
function readdir(path, ignores, callback) {
    if (typeof ignores == "function") {
        callback = ignores;
        ignores = [];
    }
    if (!callback) {
        return new Promise(function (resolve, reject) {
            readdir(path, ignores || [], function (err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data);
                }
            });
        });
    }
    ignores = ignores.map(toMatcherFunction);
    var list = [];
    fs_1.default.readdir(path, function (err, files) {
        if (err) {
            return callback(err);
        }
        var pending = files.length;
        if (!pending) {
            // we are done, woop woop
            return callback(null, list);
        }
        files.forEach(function (file) {
            var filePath = path_1.default.join(path, file);
            fs_1.default.stat(filePath, function (_err, stats) {
                if (_err) {
                    return callback(_err);
                }
                if (ignores.some(function (matcher) {
                    return matcher(filePath, stats);
                })) {
                    pending -= 1;
                    if (!pending) {
                        return callback(null, list);
                    }
                    return null;
                }
                if (stats.isDirectory()) {
                    readdir(filePath, ignores, function (__err, res) {
                        if (__err) {
                            return callback(__err);
                        }
                        // start custom code
                        list.push(filePath + "/");
                        // end custom code
                        list = list.concat(res);
                        pending -= 1;
                        if (!pending) {
                            return callback(null, list);
                        }
                    });
                }
                else {
                    list.push(filePath);
                    pending -= 1;
                    if (!pending) {
                        return callback(null, list);
                    }
                }
            });
        });
    });
}
exports.recursive = readdir;
