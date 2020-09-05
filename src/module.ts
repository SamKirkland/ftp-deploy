import * as ftp from "basic-ftp";
import readdir, { Stats } from "@jsdevtools/readdir-enhanced";
import crypto from "crypto";
import fs from "fs";
import multiMatch from "multiMatch";
import { Stream } from "stream";
import { FTPError, FTPResponse } from "basic-ftp";
import { Record, IFileList, IDiff, IFilePath, syncFileDescription, ErrorCode, IFtpDeployArguments, currentVersion, IFtpDeployArgumentsWithDefaults, DiffResult } from "./types";
import { HashDiff } from "./HashDiff";
import { pluralize, Timings, Logger, ILogger } from "./utilities";
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
      })
      // making digest
      s.on("end", function () {
        const hash = shasum.digest("hex")
        return resolve(hash);
      })
    } catch (error) {
      return reject("calc fail");
    }
  });
}

// Excludes takes precedence over includes
function includeExcludeFilter(stat: Stats, args: IFtpDeployArgumentsWithDefaults) {
  // match exclude, return immediatley
  if (args.exclude !== null) {
    const exclude = multiMatch(stat.path, args.exclude, { matchBase: true, dot: true });

    if (exclude.length > 0) {
      return false;
    }
  }

  if (args.include !== null) {
    // matches include - return immediatley
    const include = multiMatch(stat.path, args.include, { matchBase: true, dot: true });
    if (include.length > 0) {
      return true;
    }
  }

  return true;
}

async function getLocalFiles(args: IFtpDeployArgumentsWithDefaults): Promise<IFileList> {
  const files = await readdir.async(args["local-dir"], { deep: true, stats: true, sep: "/", filter: (stat) => includeExcludeFilter(stat, args) });
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
        hash: await fileHash(stat.path, "sha256")
      });

      continue;
    }

    if (stat.isSymbolicLink()) {
      console.warn("Currently unable to handle symbolic links");
    }
  }

  return {
    description: syncFileDescription,
    version: currentVersion,
    generatedTime: new Date().getTime(),
    data: records
  };
}

async function downloadFileList(client: ftp.Client, path: string): Promise<IFileList> {
  return new Promise(async (resolve, reject) => {
    const downloadStream = new Stream.Writable();
    const chunks: any[] = [];

    downloadStream._write = (chunk: any, encoding: any, next: any) => {
      chunks.push(chunk);
      next();
    }

    downloadStream.on("error", reject);
    downloadStream.on("finish", () => {
      const file = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(file));
      }
      catch (e) {
        reject(e);
      }
    });

    client.downloadTo(downloadStream, path).catch((reason: any) => {
      reject(`Can't open due to: "${reason}"`)
    });
  });
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
async function upDir(client: ftp.Client, dirCount: number | null | undefined): Promise<void> {
  if (typeof dirCount !== "number") {
    return;
  }

  // navigate back to the starting folder
  for (let i = 0; i < dirCount; i++) {
    await client.cdup();
  }
}

/**
 * 
 * @param client ftp client
 * @param file file can include folder(s)
 * Note working dir is modified and NOT reset after upload
 * For now we are going to reset it - but this will be removed for performance
 */
async function uploadFile(client: ftp.Client, filePath: string, logger: ILogger, type: "upload" | "replace" = "upload"): Promise<void> {
  const typePresent = type === "upload" ? "uploading" : "replacing";
  const typePast = type === "upload" ? "uploaded" : "replaced";
  logger.all(`${typePresent} "${filePath}"`);

  const path = getFileBreadcrumbs(filePath);

  if (path.folders === null) {
    logger.debug(`  no need to change dir`);
  }
  else {
    logger.debug(`  changing dir to ${path.folders.join("/")}`);
    await client.ensureDir(path.folders.join("/"));
    logger.debug(`  dir changed`);
  }

  if (path.file !== null) {
    logger.debug(`  ${type} started`);
    await client.uploadFrom(filePath, path.file);
    logger.debug(`  file ${typePast}`);
  }

  // navigate back to the root folder
  await upDir(client, path.folders?.length);

  logger.debug(`  completed`);
}

async function createFolder(client: ftp.Client, folderPath: string, logger: ILogger): Promise<void> {
  logger.all(`creating folder "${folderPath + "/"}"`);

  const path = getFileBreadcrumbs(folderPath + "/");

  if (path.folders === null) {
    logger.debug(`  no need to change dir`);
  }
  else {
    logger.debug(`  creating folder ${path.folders.join("/")}`);
    await client.ensureDir(path.folders.join("/"));
  }

  // navigate back to the root folder
  await upDir(client, path.folders?.length);

  logger.debug(`  completed`);
}

async function removeFolder(client: ftp.Client, folderPath: string, logger: ILogger): Promise<void> {
  logger.all(`removing folder "${folderPath + "/"}"`);

  const path = getFileBreadcrumbs(folderPath + "/");

  if (path.folders === null) {
    logger.debug(`  no need to change dir`);
  }
  else {
    try {
      logger.debug(`  removing folder "${path.folders.join("/") + "/"}"`);
      await client.removeDir(path.folders.join("/") + "/");
    }
    catch (e) {
      let error = e as FTPResponse;

      if (error.code === ErrorCode.FileNotFoundOrNoAccess) {
        logger.debug(`  could not remove folder. It doesn't exist!`);
      }
      else {
        // unknown error
        throw error;
      }
    }
  }

  // navigate back to the root folder
  await upDir(client, path.folders?.length);

  logger.debug(`  completed`);
}

async function removeFile(client: ftp.Client, filePath: string, logger: ILogger): Promise<void> {
  logger.all(`removing ${filePath}...`);

  const path = getFileBreadcrumbs(filePath);

  if (path.folders === null) {
    logger.debug(`  no need to change dir`);
  }
  else {
    logger.debug(`  changing dir to ${path.folders.join("/")}`);
    await client.ensureDir(path.folders.join("/"));
    logger.debug(`  dir changed`);
  }

  if (path.file !== null) {
    try {
      logger.debug(`  removing file ${path.file}`);
      await client.remove(path.file);
      logger.debug(`  file removed`);
    }
    catch (e) {
      let error = e as FTPResponse;

      if (error.code === ErrorCode.FileNotFoundOrNoAccess) {
        logger.info(`  could not remove file. It doesn't exist!`);
      }
      else {
        // unknown error
        throw error;
      }
    }
  }

  // navigate back to the root folder
  await upDir(client, path.folders?.length);

  logger.debug(`  completed`);
}


function createLocalState(localFiles: IFileList, logger: ILogger, args: IFtpDeployArgumentsWithDefaults): void {
  logger.debug(`Creating local state at ${args["local-dir"]}${args["state-name"]}`);
  fs.writeFileSync(`${args["local-dir"]}${args["state-name"]}`, JSON.stringify(localFiles, undefined, 4), { encoding: "utf8" });
  logger.debug("Local state created");
}

async function connect(client: ftp.Client, args: IFtpDeployArgumentsWithDefaults) {
  let secure: boolean | "implicit" = false;
  if (args.protocol === "ftps") {
    secure = true;
  }
  else if (args.protocol === "ftps-legacy") {
    secure = "implicit";
  }

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
}

async function getServerFiles(client: ftp.Client, logger: ILogger, args: IFtpDeployArgumentsWithDefaults): Promise<IFileList> {
  try {
    logger.debug(`Navigating to server dir - ${args["server-dir"]}`);
    await client.ensureDir(args["server-dir"]);
    logger.debug(`Server dir navigated to (or created)`);

    if (args["dangerous-clean-slate"]) {
      logger.all(`----------------------------------------------------------------`);
      logger.all("🗑️ Removing all files on the server because 'dangerous-clean-slate' was set, this will make the deployment very slow...");
      await client.clearWorkingDir();
      logger.all("Clear complete");

      throw new Error("nope");
    }

    const serverFiles = await downloadFileList(client, args["server-dir"] + args["state-name"]);
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
      version: currentVersion,
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
    "include": withoutDefaults.include ?? [],
    "exclude": withoutDefaults.exclude ?? excludeDefaults,
    "log-level": withoutDefaults["log-level"] ?? "info",
    "security": withoutDefaults.security ?? "loose",
  };
}

async function syncLocalToServer(client: ftp.Client, diffs: DiffResult, logger: ILogger, args: IFtpDeployArgumentsWithDefaults): Promise<any> {
  const totalCount = diffs.delete.length + diffs.upload.length + diffs.replace.length;

  logger.all(`----------------------------------------------------------------`);
  logger.all(`Making changes to ${totalCount} ${pluralize(totalCount, "file", "files")} to sync server state`);
  logger.all(`Uploading: ${prettyBytes(diffs.sizeUpload)} -- Deleting: ${prettyBytes(diffs.sizeDelete)} -- Replacing: ${prettyBytes(diffs.sizeReplace)}`);
  logger.all(`----------------------------------------------------------------`);

  // create new folders
  for (const file of diffs.upload.filter(item => item.type === "folder")) {
    await createFolder(client, file.name, logger);
  }

  // upload new files
  for (const file of diffs.upload.filter(item => item.type === "file").filter(item => item.name !== args["state-name"])) {
    await uploadFile(client, file.name, logger);
  }

  // replace new files
  for (const file of diffs.replace.filter(item => item.type === "file").filter(item => item.name !== args["state-name"])) {
    // note: FTP will replace old files with new files. We run replacements after uploads to limit downtime
    await uploadFile(client, file.name, logger, "replace");
  }

  // delete old files
  for (const file of diffs.delete.filter(item => item.type === "file")) {
    await removeFile(client, file.name, logger);
  }

  // delete old folders
  for (const file of diffs.delete.filter(item => item.type === "folder")) {
    await removeFolder(client, file.name, logger);
  }

  logger.all(`----------------------------------------------------------------`);
  logger.all(`🎉 Sync complete. Saving current server state to "${args["server-dir"] + args["state-name"]}"`);
  await client.uploadFrom(args["state-name"], args["server-dir"] + args["state-name"]);
}

export async function deploy(deployArgs: IFtpDeployArguments): Promise<void> {
  const args = getDefaultSettings(deployArgs);
  const logger = new Logger(args["log-level"] as any);
  const timings = new Timings();

  timings.start("total");

  // header
  // todo allow swapping out library/version text based on if we are using action
  logger.all(`----------------------------------------------------------------`);
  logger.all(`🚀 Thanks for using ftp-deploy version ${currentVersion}. Let's deploy some stuff!   `);
  logger.all(`----------------------------------------------------------------`);
  logger.all(`If you found this project helpful, please support it`);
  logger.all(`by giving it a ⭐ on Github --> https://github.com/SamKirkland/FTP-Deploy-Action`);
  logger.all(`or add a badge 🏷️ to your projects readme --> https://github.com/SamKirkland/FTP-Deploy-Action#badge`);

  timings.start("hash");
  const localFiles = await getLocalFiles(args);
  timings.end("hash");

  createLocalState(localFiles, logger, args);

  const client = new ftp.Client();
  client.ftp.verbose = args["log-level"] === "debug";

  let totalBytesUploaded = 0;
  try {
    timings.start("connecting");
    await connect(client, args);
    timings.end("connecting");

    try {
      const serverFiles = await getServerFiles(client, logger, args);

      const diffTool: IDiff = new HashDiff();
      const diffs = diffTool.getDiffs(localFiles, serverFiles, logger);

      totalBytesUploaded = diffs.sizeUpload + diffs.sizeReplace;

      timings.start("upload");
      try {
        await syncLocalToServer(client, diffs, logger, args);
      }
      catch (e) {
        if (e.code === ErrorCode.FileNameNotAllowed) {
          logger.warn("Error 553 FileNameNotAllowed, you don't have access to upload that file");
          logger.warn(e);
          process.exit();
        }

        logger.warn(e);
        process.exit();
      }
      finally {
        timings.end("upload");
      }

    }
    catch (error) {
      const ftpError = error as FTPError;
      if (ftpError.code === ErrorCode.FileNotFoundOrNoAccess) {
        logger.warn("Couldn't find file");
      }
      logger.warn(ftpError);
    }

  }
  catch (error) {
    prettyError(logger, args, error);
  }
  finally {
    client.close();
    timings.end("total");
  }


  const uploadSpeed = prettyBytes(totalBytesUploaded / (timings.getTime("upload") / 1000));

  // footer
  logger.all(`----------------------------------------------------------------`);
  logger.all(`Time spent hashing:               ${timings.getTimeFormatted("hash")}`);
  logger.all(`Time spent connecting to server:  ${timings.getTimeFormatted("connecting")}`);
  logger.all(`Time spent deploying:             ${timings.getTimeFormatted("upload")} (${uploadSpeed}/second)`);
  logger.all(`----------------------------------------------------------------`);
  logger.all(`Total time:                       ${timings.getTimeFormatted("total")}`);
  logger.all(`----------------------------------------------------------------`);
}