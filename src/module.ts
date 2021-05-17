import * as ftp from "basic-ftp";
import readdir, { Stats } from "@jsdevtools/readdir-enhanced";
import crypto from "crypto";
import fs from "fs";
import multiMatch from "multimatch";
import { FTPError, FTPResponse } from "basic-ftp";
import { Record, IFileList, IDiff, IFilePath, syncFileDescription, ErrorCode, IFtpDeployArguments, currentSyncFileVersion, IFtpDeployArgumentsWithDefaults, DiffResult } from "./types";
import { HashDiff } from "./HashDiff";
import { pluralize, Timings, Logger, ILogger, retryRequest } from "./utilities";
import prettyBytes from "pretty-bytes";
import { prettyError } from "./errorHandling";

/**
 * Default excludes, ignores all git files and the node_modules folder
 */
export const excludeDefaults = [".git*", ".git*/**", "node_modules/**", "node_modules/**/*"];

async function fileHash(filename: string, algorithm: "md5" | "sha1" | "sha256" | "sha512"): Promise<string> {
  return new Promise((resolve, reject) => {
    // Algorithm depends on availability of OpenSSL on platform
    // Another algorithms: "sha1", "md5", "sha256", "sha512" ...
    let shasum = crypto.createHash(algorithm);
    try {
      let s = fs.createReadStream(filename);
      s.on("data", function (data: any) {
        shasum.update(data)
      });

      s.on("error", function (error) {
        reject(error);
      });

      // making digest
      s.on("end", function () {
        const hash = shasum.digest("hex")
        return resolve(hash);
      });
    } catch (error) {
      return reject("calc fail");
    }
  });
}

function applyExcludeFilter(stat: Stats, args: IFtpDeployArgumentsWithDefaults) {
  // match exclude, return immediatley
  if (args.exclude.length > 0) {
    const excludeMatch = multiMatch(stat.path, args.exclude, { matchBase: true, dot: true });

    if (excludeMatch.length > 0) {
      return false;
    }
  }

  return true;
}

export async function getLocalFiles(args: IFtpDeployArgumentsWithDefaults): Promise<IFileList> {
  const files = await readdir.async(args["local-dir"], { deep: true, stats: true, sep: "/", filter: (stat) => applyExcludeFilter(stat, args) });
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

async function downloadFileList(client: ftp.Client, logger: ILogger, path: string): Promise<IFileList> {
  // note: originally this was using a writable stream instead of a buffer file
  // basic-ftp doesn't seam to close the connection when using steams over some ftps connections. This appears to be dependent on the ftp server
  const tempFileNameHack = ".ftp-deploy-sync-server-state-buffer-file---delete.json";

  await retryRequest(logger, async () => await client.downloadTo(tempFileNameHack, path));

  const fileAsString = fs.readFileSync(tempFileNameHack, { encoding: "utf-8" });
  const fileAsObject = JSON.parse(fileAsString) as IFileList;

  fs.unlinkSync(tempFileNameHack);

  return fileAsObject;
}


/**
 * Converts a file path (ex: "folder/otherfolder/file.txt") to an array of folder and a file path
 * @param fullPath 
 */
function getFileBreadcrumbs(fullPath: string): IFilePath {
  // todo see if this regex will work for nonstandard folder names
  // todo what happens if the path is relative to the root dir? (starts with /)
  const pathSplit = fullPath.split("/");
  const file = pathSplit?.pop() ?? ""; // get last item
  const folders = pathSplit.filter(folderName => folderName != "");

  return {
    folders: folders.length === 0 ? null : folders,
    file: file === "" ? null : file
  };
}

/**
 * Navigates up {dirCount} number of directories from the current working dir
 */
async function upDir(client: ftp.Client, logger: ILogger, dirCount: number | null | undefined): Promise<void> {
  if (typeof dirCount !== "number") {
    return;
  }

  // navigate back to the starting folder
  for (let i = 0; i < dirCount; i++) {
    await retryRequest(logger, async () => await client.cdup());
  }
}

async function ensureDir(client: ftp.Client, logger: ILogger, timings: Timings, folder: string): Promise<void> {
  timings.start("changingDir");
  logger.verbose(`  changing dir to ${folder}`);

  await retryRequest(logger, async () => await client.ensureDir(folder));

  logger.verbose(`  dir changed`);
  timings.stop("changingDir");
}

/**
 * 
 * @param client ftp client
 * @param file file can include folder(s)
 * Note working dir is modified and NOT reset after upload
 * For now we are going to reset it - but this will be removed for performance
 */
async function uploadFile(client: ftp.Client, basePath: string, filePath: string, logger: ILogger, type: "upload" | "replace" = "upload", dryRun: boolean): Promise<void> {
  const typePresent = type === "upload" ? "uploading" : "replacing";
  const typePast = type === "upload" ? "uploaded" : "replaced";
  logger.all(`${typePresent} "${filePath}"`);

  if (dryRun === false) {
    await retryRequest(logger, async () => await client.uploadFrom(basePath + filePath, filePath));
  }

  logger.verbose(`  file ${typePast}`);
}

async function createFolder(client: ftp.Client, folderPath: string, logger: ILogger, timings: Timings, dryRun: boolean): Promise<void> {
  logger.all(`creating folder "${folderPath + "/"}"`);

  if (dryRun === true) {
    return;
  }

  const path = getFileBreadcrumbs(folderPath + "/");

  if (path.folders === null) {
    logger.verbose(`  no need to change dir`);
  }
  else {
    await ensureDir(client, logger, timings, path.folders.join("/"));
  }

  // navigate back to the root folder
  await upDir(client, logger, path.folders?.length);

  logger.verbose(`  completed`);
}

async function removeFolder(client: ftp.Client, folderPath: string, logger: ILogger, dryRun: boolean): Promise<void> {
  logger.all(`removing folder "${folderPath + "/"}"`);

  const path = getFileBreadcrumbs(folderPath + "/");

  if (path.folders === null) {
    logger.verbose(`  no need to change dir`);
  }
  else {
    try {
      logger.verbose(`  removing folder "${path.folders.join("/") + "/"}"`);
      if (dryRun === false) {
        await retryRequest(logger, async () => await client.removeDir(path.folders!.join("/") + "/"));
      }
    }
    catch (e) {
      let error = e as FTPResponse;

      if (error.code === ErrorCode.FileNotFoundOrNoAccess) {
        logger.verbose(`  could not remove folder. It doesn't exist!`);
      }
      else {
        // unknown error
        throw error;
      }
    }
  }

  // navigate back to the root folder
  await upDir(client, logger, path.folders?.length);

  logger.verbose(`  completed`);
}

async function removeFile(client: ftp.Client, basePath: string, filePath: string, logger: ILogger, dryRun: boolean): Promise<void> {
  logger.all(`removing ${filePath}...`);

  try {
    if (dryRun === false) {
      await retryRequest(logger, async () => await client.remove(basePath + filePath));
    }
    logger.verbose(`  file removed`);
  }
  catch (e) {
    let error = e as FTPResponse;

    if (error.code === ErrorCode.FileNotFoundOrNoAccess) {
      logger.verbose(`  could not remove file. It doesn't exist!`);
    }
    else {
      // unknown error
      throw error;
    }
  }

  logger.verbose(`  completed`);
}

function createLocalState(localFiles: IFileList, logger: ILogger, args: IFtpDeployArgumentsWithDefaults): void {
  logger.verbose(`Creating local state at ${args["local-dir"]}${args["state-name"]}`);
  fs.writeFileSync(`${args["local-dir"]}${args["state-name"]}`, JSON.stringify(localFiles, undefined, 4), { encoding: "utf8" });
  logger.verbose("Local state created");
}

async function connect(client: ftp.Client, args: IFtpDeployArgumentsWithDefaults, logger: ILogger) {
  let secure: boolean | "implicit" = false;
  if (args.protocol === "ftps") {
    secure = true;
  }
  else if (args.protocol === "ftps-legacy") {
    secure = "implicit";
  }

  client.ftp.verbose = args["log-level"] === "verbose";

  const rejectUnauthorized = args.security === "loose";

  await client.access({
    host: args.server,
    user: args.username,
    password: args.password,
    port: args.port,
    secure: secure,
    secureOptions: {
      rejectUnauthorized: rejectUnauthorized
    }
  });

  if (args["log-level"] === "verbose") {
    client.trackProgress(info => {
      logger.verbose(`${info.type} progress for "${info.name}". Progress: ${info.bytes} bytes of ${info.bytesOverall} bytes`);
    });
  }
}

async function getServerFiles(client: ftp.Client, logger: ILogger, timings: Timings, args: IFtpDeployArgumentsWithDefaults): Promise<IFileList> {
  try {
    await ensureDir(client, logger, timings, args["server-dir"]);

    if (args["dangerous-clean-slate"]) {
      logger.all(`----------------------------------------------------------------`);
      logger.all("🗑️ Removing all files on the server because 'dangerous-clean-slate' was set, this will make the deployment very slow...");
      await client.clearWorkingDir();
      logger.all("Clear complete");

      throw new Error("nope");
    }

    const serverFiles = await downloadFileList(client, logger, args["state-name"]);
    logger.all(`----------------------------------------------------------------`);
    logger.all(`Last published on 📅 ${new Date(serverFiles.generatedTime).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric" })}`);

    return serverFiles;
  }
  catch (e) {
    logger.all(`----------------------------------------------------------------`);
    logger.all(`No file exists on the server "${args["server-dir"] + args["state-name"]}" - this much be your first publish! 🎉`);
    logger.all(`The first publish will take a while... but once the initial sync is done only differences are published!`);
    logger.all(`If you get this message and its NOT your first publish, something is wrong.`);

    // set the server state to nothing, because we don't know what the server state is
    return {
      description: syncFileDescription,
      version: currentSyncFileVersion,
      generatedTime: new Date().getTime(),
      data: [],
    };
  }
}

function getDefaultSettings(withoutDefaults: IFtpDeployArguments): IFtpDeployArgumentsWithDefaults {
  if (withoutDefaults["local-dir"] !== undefined) {
    if (!withoutDefaults["local-dir"].endsWith("/")) {
      throw new Error("local-dir should be a folder (must end with /)");
    }
  }
  if (withoutDefaults["server-dir"] !== undefined) {
    if (!withoutDefaults["server-dir"].endsWith("/")) {
      throw new Error("server-dir should be a folder (must end with /)");
    }
  }

  return {
    "server": withoutDefaults.server,
    "username": withoutDefaults.username,
    "password": withoutDefaults.password,
    "port": withoutDefaults.port ?? 21,
    "protocol": withoutDefaults.protocol ?? "ftp",
    "local-dir": withoutDefaults["local-dir"] ?? "./",
    "server-dir": withoutDefaults["server-dir"] ?? "./",
    "state-name": withoutDefaults["state-name"] ?? ".ftp-deploy-sync-state.json",
    "dry-run": withoutDefaults["dry-run"] ?? false,
    "dangerous-clean-slate": withoutDefaults["dangerous-clean-slate"] ?? false,
    "exclude": withoutDefaults.exclude ?? excludeDefaults,
    "log-level": withoutDefaults["log-level"] ?? "standard",
    "security": withoutDefaults.security ?? "loose",
  };
}

async function syncLocalToServer(client: ftp.Client, diffs: DiffResult, logger: ILogger, timings: Timings, args: IFtpDeployArgumentsWithDefaults): Promise<any> {
  const totalCount = diffs.delete.length + diffs.upload.length + diffs.replace.length;

  logger.all(`----------------------------------------------------------------`);
  logger.all(`Making changes to ${totalCount} ${pluralize(totalCount, "file", "files")} to sync server state`);
  logger.all(`Uploading: ${prettyBytes(diffs.sizeUpload)} -- Deleting: ${prettyBytes(diffs.sizeDelete)} -- Replacing: ${prettyBytes(diffs.sizeReplace)}`);
  logger.all(`----------------------------------------------------------------`);

  const basePath = args["local-dir"];

  // create new folders
  for (const file of diffs.upload.filter(item => item.type === "folder")) {
    await createFolder(client, file.name, logger, timings, args["dry-run"]);
  }

  // upload new files
  for (const file of diffs.upload.filter(item => item.type === "file").filter(item => item.name !== args["state-name"])) {
    await uploadFile(client, basePath, file.name, logger, "upload", args["dry-run"]);
  }

  // replace new files
  for (const file of diffs.replace.filter(item => item.type === "file").filter(item => item.name !== args["state-name"])) {
    // note: FTP will replace old files with new files. We run replacements after uploads to limit downtime
    await uploadFile(client, basePath, file.name, logger, "replace", args["dry-run"]);
  }

  // delete old files
  for (const file of diffs.delete.filter(item => item.type === "file")) {
    await removeFile(client, basePath, file.name, logger, args["dry-run"]);
  }

  // delete old folders
  for (const file of diffs.delete.filter(item => item.type === "folder")) {
    await removeFolder(client, file.name, logger, args["dry-run"]);
  }

  logger.all(`----------------------------------------------------------------`);
  logger.all(`🎉 Sync complete. Saving current server state to "${args["server-dir"] + args["state-name"]}"`);
  if (args["dry-run"] === false) {
    await retryRequest(logger, async () => await client.uploadFrom(args["local-dir"] + args["state-name"], args["state-name"]));
  }
}


export async function deploy(deployArgs: IFtpDeployArguments): Promise<void> {
  const args = getDefaultSettings(deployArgs);
  const logger = new Logger(args["log-level"]);
  const timings = new Timings();

  timings.start("total");

  // header
  logger.all(`----------------------------------------------------------------`);
  logger.all(`🚀 Thanks for using ftp-deploy. Let's deploy some stuff!   `);
  logger.all(`----------------------------------------------------------------`);
  logger.all(`If you found this project helpful, please support it`);
  logger.all(`by giving it a ⭐ on Github --> https://github.com/SamKirkland/FTP-Deploy-Action`);
  logger.all(`or add a badge 🏷️ to your projects readme --> https://github.com/SamKirkland/FTP-Deploy-Action#badge`);

  timings.start("hash");
  const localFiles = await getLocalFiles(args);
  timings.stop("hash");

  createLocalState(localFiles, logger, args);

  const client = new ftp.Client();

  global.reconnect = async function () {
    timings.start("connecting");
    await connect(client, args, logger);
    timings.stop("connecting");
  }


  let totalBytesUploaded = 0;
  try {
    await global.reconnect();

    try {
      const serverFiles = await getServerFiles(client, logger, timings, args);

      timings.start("logging");
      const diffTool: IDiff = new HashDiff();
      const diffs = diffTool.getDiffs(localFiles, serverFiles, logger);
      timings.stop("logging");

      totalBytesUploaded = diffs.sizeUpload + diffs.sizeReplace;

      timings.start("upload");
      try {
        await syncLocalToServer(client, diffs, logger, timings, args);
      }
      catch (e) {
        if (e.code === ErrorCode.FileNameNotAllowed) {
          logger.all("Error 553 FileNameNotAllowed, you don't have access to upload that file");
        }
        logger.all(e);

        throw e;
      }
      finally {
        timings.stop("upload");
      }

    }
    catch (error) {
      const ftpError = error as FTPError;
      if (ftpError.code === ErrorCode.FileNotFoundOrNoAccess) {
        logger.all("Couldn't find file");
      }

      logger.all(ftpError);
    }

  }
  catch (error) {
    prettyError(logger, args, error);
    throw error;
  }
  finally {
    client.close();
    timings.stop("total");
  }


  const uploadSpeed = prettyBytes(totalBytesUploaded / (timings.getTime("upload") / 1000));

  // footer
  logger.all(`----------------------------------------------------------------`);
  logger.all(`Time spent hashing:               ${timings.getTimeFormatted("hash")}`);
  logger.all(`Time spent connecting to server:  ${timings.getTimeFormatted("connecting")}`);
  logger.all(`Time spent deploying:             ${timings.getTimeFormatted("upload")} (${uploadSpeed}/second)`);
  logger.all(`  - changing dirs:                ${timings.getTimeFormatted("changingDir")}`);
  logger.all(`  - logging:                      ${timings.getTimeFormatted("logging")}`);
  logger.all(`----------------------------------------------------------------`);
  logger.all(`Total time:                       ${timings.getTimeFormatted("total")}`);
  logger.all(`----------------------------------------------------------------`);
}