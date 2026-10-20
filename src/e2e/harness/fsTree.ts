import fs from "fs";
import path from "path";

/**
 * Declarative description of a directory.
 *   - string / Buffer value => file with that content
 *   - object value          => directory (use {} for an empty directory)
 *
 * @example { "index.html": "<html/>", assets: { "a.png": Buffer.from([1,2,3]) }, empty: {} }
 */
export type TreeSpec = { [name: string]: string | Buffer | TreeSpec };

/** Flat representation: posix relative path => file content (string) or null for a directory */
export type FlatTree = { [relativePath: string]: string | null };

function isSpec(value: string | Buffer | TreeSpec): value is TreeSpec {
    return typeof value === "object" && !Buffer.isBuffer(value);
}

export function writeTree(root: string, spec: TreeSpec): void {
    fs.mkdirSync(root, { recursive: true });

    for (const [name, value] of Object.entries(spec)) {
        const target = path.join(root, name);
        if (isSpec(value)) {
            writeTree(target, value);
        }
        else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, value);
        }
    }
}

export function flattenSpec(spec: TreeSpec, prefix = ""): FlatTree {
    const result: FlatTree = {};

    for (const [name, value] of Object.entries(spec)) {
        const fullPath = prefix + name;
        if (isSpec(value)) {
            result[fullPath] = null;
            Object.assign(result, flattenSpec(value, fullPath + "/"));
        }
        else {
            result[fullPath] = bufferToComparable(Buffer.isBuffer(value) ? value : Buffer.from(value));
        }
    }

    return result;
}

/** Text that round-trips through utf8 stays readable in diffs, everything else becomes base64 */
function bufferToComparable(buffer: Buffer): string {
    const asText = buffer.toString("utf8");
    return Buffer.from(asText, "utf8").equals(buffer) ? asText : `base64:${buffer.toString("base64")}`;
}

/** Reads a directory from disk into a flat tree. `ignore` receives relative posix paths. */
export function readTree(root: string, ignore: (relativePath: string) => boolean = () => false): FlatTree {
    const result: FlatTree = {};

    const walk = (dir: string, prefix: string) => {
        if (!fs.existsSync(dir)) { return; }

        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const relativePath = prefix + entry.name;
            if (ignore(relativePath)) { continue; }

            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                result[relativePath] = null;
                walk(full, relativePath + "/");
            }
            else if (entry.isFile()) {
                result[relativePath] = bufferToComparable(fs.readFileSync(full));
            }
        }
    };

    walk(root, "");
    return result;
}

export function sortTree(tree: FlatTree): FlatTree {
    return Object.fromEntries(Object.entries(tree).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Human readable differences between two trees. Empty array means identical.
 * Designed to be used as `expect(diffTrees(actual, expected)).toEqual([])` so failures list exactly what is wrong.
 */
export function diffTrees(actual: FlatTree, expected: FlatTree): string[] {
    const problems: string[] = [];
    const describe = (value: string | null) => (value === null ? "<directory>" : JSON.stringify(value.length > 60 ? value.slice(0, 60) + "…" : value));

    for (const key of Object.keys(expected).sort()) {
        if (!(key in actual)) {
            problems.push(`MISSING   ${key}  (expected ${describe(expected[key])})`);
        }
        else if (actual[key] !== expected[key]) {
            problems.push(`DIFFERENT ${key}  (expected ${describe(expected[key])}, got ${describe(actual[key])})`);
        }
    }

    for (const key of Object.keys(actual).sort()) {
        if (!(key in expected)) {
            problems.push(`EXTRA     ${key}  (${describe(actual[key])})`);
        }
    }

    return problems;
}

export function removeTree(root: string): void {
    fs.rmSync(root, { recursive: true, force: true });
}
