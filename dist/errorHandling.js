"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prettyError = void 0;
const types_1 = require("./types");
function logOriginalError(logger, error) {
    logger.all();
    logger.all(`----------------------------------------------------------------`);
    logger.all(`----------------------  full error below  ----------------------`);
    logger.all(`----------------------------------------------------------------`);
    logger.all();
    logger.all(error);
}
/**
 * Converts a exception to helpful debug info
 * @param error exception
 */
function prettyError(logger, args, error) {
    logger.all();
    logger.all(`----------------------------------------------------------------`);
    logger.all(`--------------  🔥🔥🔥 an error occurred  🔥🔥🔥  --------------`);
    logger.all(`----------------------------------------------------------------`);
    const ftpError = error;
    if (typeof error.code === "string") {
        const errorCode = error.code;
        if (errorCode === "ENOTFOUND") {
            logger.all(`The server "${args.server}" doesn't seem to exist. Do you have a typo?`);
        }
    }
    else if (typeof error.name === "string") {
        const errorName = error.name;
        if (errorName.includes("ERR_TLS_CERT_ALTNAME_INVALID")) {
            logger.all(`The certificate for "${args.server}" is likely shared. The host did not place your server on the list of valid domains for this cert.`);
            logger.all(`This is a common issue with shared hosts. You have a few options:`);
            logger.all(` - Ignore this error by setting security back to loose`);
            logger.all(` - Contact your hosting provider and ask them for your servers hostname`);
        }
    }
    else if (typeof ftpError.code === "number") {
        if (ftpError.code === types_1.ErrorCode.NotLoggedIn) {
            const serverRequiresFTPS = ftpError.message.toLowerCase().includes("must use encryption");
            if (serverRequiresFTPS) {
                logger.all(`The server you are connecting to requires encryption (ftps)`);
                logger.all(`Enable FTPS by using the protocol option.`);
            }
            else {
                logger.all(`Could not login with the username "${args.username}" and password "${args.password}".`);
                logger.all(`Make sure you can login with those credentials. If you have a space or a quote in your username or password be sure to escape them!`);
            }
        }
    }
    logOriginalError(logger, error);
}
exports.prettyError = prettyError;
