import * as core from "@actions/core";
import * as ftp from "basic-ftp";
import readdir, { Stats } from "@jsdevtools/readdir-enhanced";
import crypto from "crypto";
import fs from "fs";
import multiMatch from "multiMatch";
import { Stream } from "stream";
import { FTPError, FTPResponse } from "basic-ftp";
import { Record, IFileList, IDiff, IFilePath, syncFileDescription, ErrorCode } from "./types";
import { HashDiff } from "./HashDiff";
import { pluralize, Timings, Logger } from "./utilities";
import prettyBytes from "pretty-bytes";
import yargs from "yargs";

const argv = yargs.options({
  "server": { type: "string", demandOption: true },
  "username": { type: "string", demandOption: true },
  "password": { type: "string", demandOption: true },
  "local-dir": { type: "string", default: "./" },
  "server-dir": { type: "string", default: "./" },
  "state-name": { type: "string", default: ".ftp-deploy-sync-state.json" },
  "dry-run": { type: "boolean", default: false, description: "Prints which modifications will be made with current config options, but doesn't actually make any changes" },
  "dangerous-clean-slate": { type: "boolean", default: false, description: "Deletes ALL contents of server-dir, even items in excluded with 'exclude' argument" },
  "include": { type: "array", default: [], description: "An array of glob patterns, these files will always be included in the publish/delete process - even if no change occurred" },
  "exclude": { type: "array", default: [".git*", ".git*/**", "node_modules/**", "node_modules/**/*"], description: "An array of glob patterns, these files will not be included in the publish/delete process" },
  "log-level": { choices: ["warn", "info", "debug"], default: "info", description: "How much information should print. warn=only important info, info=warn+file changes, debug=print everything the script is doing" },
})
  .example("$0 --server ftp://samkirkland.com --username user --password pass", "")
  .help("help")
  .epilog("Read more at https://github.com/SamKirkland/FTP-Deploy-Action")
  .argv;


async function fileHash(filename: string, algorithm: "md5" | "sha1" | "sha256" | "sha512"): Promise<string> {
  return new Promise((resolve, reject) => {
    // Algorithm depends on availability of OpenSSL on platform
    // Another algorithms: "sha1", "md5", "sha256", "sha512" ...
    let shasum = crypto.createHash(algorithm);
    try {
      let s = fs.createReadStream(filename);
      s.on("data", function (data) {
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
function includeExcludeFilter(stat: Stats) {
  // match exclude, return immediatley
  if (argv.exclude !== null) {
    const exclude = multiMatch(stat.path, argv.exclude, { matchBase: true, dot: true });

    if (exclude.length > 0) {
      return false;
    }
  }

  if (argv.include !== null) {
    // matches include - return immediatley
    const include = multiMatch(stat.path, argv.include, { matchBase: true, dot: true });
    if (include.length > 0) {
      return true;
    }
  }

  return true;
}

async function getLocalFiles(): Promise<IFileList> {
  const files = await readdir.async("./", { deep: true, stats: true, sep: "/", filter: includeExcludeFilter });
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
    version: "1.0.0",
    generatedTime: new Date().getTime(),
    data: records
  };
}

async function downloadFileList(client: ftp.Client, path: string): Promise<IFileList> {
  return new Promise(async (resolve, reject) => {
    const downloadStream = new Stream.Writable();
    const chunks: any[] = [];

    downloadStream._write = (chunk, encoding, next) => {
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

    client.downloadTo(downloadStream, path).catch((reason) => {
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
async function uploadFile(client: ftp.Client, filePath: string): Promise<void> {
  logger.all(`uploading "${filePath}"`);

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
    logger.debug(`  upload started`);
    await client.uploadFrom(filePath, path.file);
    logger.debug(`  file uploaded`);
  }

  // navigate back to the root folder
  await upDir(client, path.folders?.length);

  logger.debug(`  completed`);
}

async function createFolder(client: ftp.Client, folderPath: string): Promise<void> {
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

async function removeFolder(client: ftp.Client, folderPath: string): Promise<void> {
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

  logger.info(`  completed`);
}

async function removeFile(client: ftp.Client, filePath: string): Promise<void> {
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

  logger.info(`  Completed`);
}

const logger = new Logger(argv["log-level"] as any);

async function runScript(): Promise<void> {
  try {
    logger.all(`------------------------------------------------------`);
    logger.all(`🚀 Welcome. Let's deploy some stuff!   `);
    logger.all(`------------------------------------------------------`);
    logger.all(`If you found this project helpful, please support it`);
    logger.all(`by giving it a ⭐ on Github --> https://github.com/SamKirkland/FTP-Deploy-Action`);

    const timings = new Timings();
    timings.start("total");

    timings.start("hash");
    const localFiles = await getLocalFiles();
    timings.end("hash");

    fs.writeFileSync(`./${argv["state-name"]}`, JSON.stringify(localFiles, undefined, 4), { encoding: "utf8" });

    const client = new ftp.Client();
    client.ftp.verbose = argv["log-level"] === "debug";

    let totalBytesUploaded: number = 0;
    try {
      timings.start("connecting");
      await client.access({
        host: argv.server,
        user: argv.username,
        password: argv.password,
        secure: false
      });
      timings.end("connecting");

      try {
        let serverFiles: IFileList;

        try {
          if (argv["dangerous-clean-slate"]) {
            logger.all(`------------------------------------------------------`);
            logger.all("🗑️ Removing all files on the server because 'dangerous-clean-slate' was set, this will make the deployment very slow...");
            await client.clearWorkingDir();
            logger.all("Clear complete");

            throw new Error("nope");
          }

          serverFiles = await downloadFileList(client, argv["state-name"]);
          logger.all(`------------------------------------------------------`);
          logger.all(`Last published on 📅 ${new Date(serverFiles.generatedTime).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric" })}`);
        }
        catch (e) {
          logger.all(`------------------------------------------------------`);
          logger.all(`No file exists on the server "${argv["state-name"]}" - this much be your first publish! 🎉`);
          logger.all(`The first publish will take a while... but once the initial sync is done only differences are published!`);
          logger.all(`If you get this message and its NOT your first publish, something is wrong.`);

          // set the server state to nothing, because we don't know what the server state is
          serverFiles = {
            description: syncFileDescription,
            version: "1.0.0",
            generatedTime: new Date().getTime(),
            data: [],
          };
        }

        const diffTool: IDiff = new HashDiff();
        const diffs = diffTool.getDiffs(localFiles, serverFiles, logger);

        totalBytesUploaded = diffs.sizeUpload + diffs.sizeReplace;

        timings.start("upload");
        try {
          const totalCount = diffs.delete.length + diffs.upload.length + diffs.replace.length;

          logger.all(`------------------------------------------------------`);
          logger.all(`Making changes to ${totalCount} ${pluralize(totalCount, "file", "files")} to sync server state`);
          logger.all(`Uploading: ${prettyBytes(diffs.sizeUpload)} -- Deleting: ${prettyBytes(diffs.sizeDelete)} -- Replacing: ${prettyBytes(diffs.sizeReplace)}`);
          logger.all(`------------------------------------------------------`);

          // create new folders
          for (const file of diffs.upload.filter(item => item.type === "folder")) {
            await createFolder(client, file.name);
          }

          // upload new files
          for (const file of diffs.upload.filter(item => item.type === "file").filter(item => item.name !== argv["state-name"])) {
            await uploadFile(client, file.name);
          }

          // replace new files
          for (const file of diffs.replace.filter(item => item.type === "file").filter(item => item.name !== argv["state-name"])) {
            // note: FTP will replace old files with new files. We run replacements after uploads to limit downtime
            await uploadFile(client, file.name);
          }

          // delete old files
          for (const file of diffs.delete.filter(item => item.type === "file")) {
            await removeFile(client, file.name);
          }

          // delete old folders
          for (const file of diffs.delete.filter(item => item.type === "folder")) {
            await removeFolder(client, file.name);
          }

          logger.all(`------------------------------------------------------`);
          logger.all(`🎉 Sync complete. Saving current server state to "${argv["state-name"]}"`);
          await client.uploadFrom(argv["state-name"], argv["state-name"]);
        }
        catch (e) {
          if (e.code === 553) {
            logger.warn("Error 553, you don't have access to upload the file");
            return;
          }

          logger.warn("Error:", typeof e, JSON.stringify(e), e);
        }
        timings.end("upload");

      }
      catch (error) {
        const ftpError = error as FTPError;
        if (ftpError.code === ErrorCode.FileNotFoundOrNoAccess) {
          logger.warn("Couldn't find file");
        }
        logger.warn(ftpError);
      }

    }
    catch (err) {
      logger.warn(err);
    }
    client.close();

    timings.end("total");

    const uploadSpeed = prettyBytes(totalBytesUploaded / (timings.getTime("upload") / 1000));
    logger.all(`------------------------------------------------------`);
    logger.all(`Time spent hashing:          ${timings.getTimeFormatted("hash")}`);
    logger.all(`Time spent connecting to server:    ${timings.getTimeFormatted("connecting")}`);
    logger.all(`Time spent deploying:        ${timings.getTimeFormatted("upload")} (${uploadSpeed}/second)`);
    logger.all(`------------------------------------------------------`);
    logger.all(`Total time:                  ${timings.getTimeFormatted("total")}`);
    logger.all(`------------------------------------------------------`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

runScript();