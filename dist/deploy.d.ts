import { IFtpDeployArgumentsWithDefaults } from "./types";
import { ILogger, ITimings } from "./utilities";
export declare function deploy(args: IFtpDeployArgumentsWithDefaults, logger: ILogger, timings: ITimings): Promise<void>;
