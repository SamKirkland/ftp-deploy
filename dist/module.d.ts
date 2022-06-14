import { IFtpDeployArguments } from "./types";
/**
 * Default excludes, ignores all git files and the node_modules folder
 * **\/.git* ignores all FILES that start with .git(in any folder or sub-folder)
 * **\/.git*\/** ignores all FOLDERS that start with .git (in any folder or sub-folder)
 * **\/node_modules\/** ignores all FOLDERS named node_modules (in any folder or sub-folder)
 */
export declare const excludeDefaults: string[];
/**
 * Syncs a local folder with a remote folder over FTP.
 * After the initial sync only differences are synced, making deployments super fast!
 */
export declare function deploy(args: IFtpDeployArguments): Promise<void>;
