import readdir from "@jsdevtools/readdir-enhanced";
import { Record, IFileList, syncFileDescription, currentSyncFileVersion, IFtpDeployArgumentsWithDefaults } from "./types";
import { fileHash } from "./HashDiff";
import { applyExcludeFilter } from "./utilities";

export async function getLocalFiles(args: IFtpDeployArgumentsWithDefaults): Promise<IFileList> {
    const files = await readdir.async(args["local-dir"], { deep: true, stats: true, sep: "/", filter: (stat) => applyExcludeFilter(stat, args.exclude) });
    const records: Record[] = [];

    for (let stat of files) {
        if (stat.isDirectory()) {
            records.push({
                type: "folder",
                name: stat.path,
                size: undefined
            });

            continue;
        }

        if (stat.isFile()) {
            records.push({
                type: "file",
                name: stat.path,
                size: stat.size,
                hash: await fileHash(args["local-dir"] + stat.path, "sha256")
            });

            continue;
        }

        if (stat.isSymbolicLink()) {
            console.warn("This script is currently unable to handle symbolic links - please add a feature request if you need this");
        }
    }

    return {
        description: syncFileDescription,
        version: currentSyncFileVersion,
        generatedTime: new Date().getTime(),
        data: records
    };
}
