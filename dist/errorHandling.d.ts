import { ILogger } from "./utilities";
import { IFtpDeployArgumentsWithDefaults } from "./types";
/**
 * Converts a exception to helpful debug info
 * @param error exception
 */
export declare function prettyError(logger: ILogger, args: IFtpDeployArgumentsWithDefaults, error: any): void;
