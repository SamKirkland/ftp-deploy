// modified version of https://github.com/jergason/recursive-readdir
// to add folder list support

import fs from "fs";
import p from "path";
import minimatch from "minimatch";

type IgnoreFunction = (file: string, stats: fs.Stats) => boolean;
type Ignores = ReadonlyArray<string | IgnoreFunction>;
type Callback = (error: Error, files: string[]) => void;

interface readDir {
    (path: string, ignores?: Ignores): Promise<string[]>;
    (path: string, callback: Callback): void;
    (path: string, ignores: Ignores, callback: Callback): void;
}

function patternMatcher(pattern: any) {
    return function (path: any, stats: any) {
        var minimatcher = new minimatch.Minimatch(pattern, { matchBase: true });
        return (!minimatcher.negate || stats.isFile()) && minimatcher.match(path);
    };
}

function toMatcherFunction(ignoreEntry: any) {
    if (typeof ignoreEntry == "function") {
        return ignoreEntry;
    } else {
        return patternMatcher(ignoreEntry);
    }
}

function readdir(path: any, ignores: any, callback: any) {
    if (typeof ignores == "function") {
        callback = ignores;
        ignores = [];
    }

    if (!callback) {
        return new Promise(function (resolve, reject) {
            readdir(path, ignores || [], function (err: any, data: any) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    ignores = ignores.map(toMatcherFunction);

    var list: any = [];

    fs.readdir(path, function (err, files) {
        if (err) {
            return callback(err);
        }

        var pending = files.length;
        if (!pending) {
            // we are done, woop woop
            return callback(null, list);
        }

        files.forEach(function (file) {
            var filePath = p.join(path, file);
            fs.stat(filePath, function (_err, stats) {
                if (_err) {
                    return callback(_err);
                }

                if (
                    ignores.some(function (matcher: any) {
                        return matcher(filePath, stats);
                    })
                ) {
                    pending -= 1;
                    if (!pending) {
                        return callback(null, list);
                    }
                    return null;
                }

                if (stats.isDirectory()) {
                    readdir(filePath, ignores, function (__err: any, res: any) {
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
                } else {
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


export const recursive = readdir as readDir;