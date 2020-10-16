import { ILogger } from "./utilities";
import { IFtpDeployArgumentsWithDefaults, ErrorCode } from "./types";
import { FTPError } from "basic-ftp";


function outputOriginalErrorAndExit(logger: ILogger, error: any) {
    logger.all();
    logger.all(`----------------------------------------------------------------`);
    logger.all(`----------------------  Full Error below  ----------------------`);
    logger.all(error);
    process.exit();
}


/**
 * Converts a exception to helpful debug info
 * @param error exception
 */
export function prettyError(logger: ILogger, args: IFtpDeployArgumentsWithDefaults, error: any): void {
    logger.all();
    logger.all(`----------------------------------------------------------------`);
    logger.all(`---------------  🔥🔥🔥 A error occurred  🔥🔥🔥  --------------`);
    logger.all(`----------------------------------------------------------------`);

    if (typeof error.code === "string") {
        const errorCode = error.code as string;

        if (errorCode === "ENOTFOUND") {
            logger.all(`The server "${args.server}" doesn't seem to exist. Do you have a typo?`);

            outputOriginalErrorAndExit(logger, error);
        }
    }

    if (typeof error.name === "string") {
        const errorName = error.name as string;

        if (errorName.includes("ERR_TLS_CERT_ALTNAME_INVALID")) {
            logger.all(`The certificate for "${args.server}" is likely shared. The host did not place your server on the list of valid domains for this cert.`);
            logger.all(`This is a common issue with shared hosts. You have a few options:`);
            logger.all(` - Ignore this error by setting security back to loose`);
            logger.all(` - Contact your hosting provider and ask them for your servers hostname`);

            outputOriginalErrorAndExit(logger, error);
        }
    }

    const ftpError = error as FTPError;
    if (typeof ftpError.code === "number") {
        if (ftpError.code === ErrorCode.NotLoggedIn) {
            const serverRequiresFTPS = ftpError.message.toLowerCase().includes("must use encryption");

            if (serverRequiresFTPS) {
                logger.all(`The server you are connecting to requires encryption (ftps)`);
                logger.all(`Enable FTPS by using the protocol option.`);

                outputOriginalErrorAndExit(logger, error);
            }
            else {
                logger.all(`Could not login with the username "${args.username}" and password "${args.password}".`);
                logger.all(`Make sure you can login with those credentials. If you have a space or a quote in your username or password be sure to escape them!`);

                outputOriginalErrorAndExit(logger, error);
            }
        }
    }


    // unknown error :(
    outputOriginalErrorAndExit(logger, error);
}
