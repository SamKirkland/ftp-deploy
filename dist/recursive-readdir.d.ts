/// <reference types="node" />
import fs from "fs";
declare type IgnoreFunction = (file: string, stats: fs.Stats) => boolean;
declare type Ignores = ReadonlyArray<string | IgnoreFunction>;
declare type Callback = (error: Error, files: string[]) => void;
interface readDir {
    (path: string, ignores?: Ignores): Promise<string[]>;
    (path: string, callback: Callback): void;
    (path: string, ignores: Ignores, callback: Callback): void;
}
export declare const recursive: readDir;
export {};
