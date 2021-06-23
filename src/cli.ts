#! /usr/bin/env node

import { deploy, excludeDefaults } from "./module";
import yargs from "yargs";
import { IFtpDeployArguments } from "./types";

const argv = yargs.options({
    "server": { type: "string", demandOption: true },
    "username": { type: "string", demandOption: true },
    "password": { type: "string", demandOption: true },
    "port": { type: "number", default: 21 },
    "local-dir": { type: "string", default: "./" },
    "server-dir": { type: "string", default: "./" },
    "state-name": { type: "string", default: ".ftp-deploy-sync-state.json" },
    "dry-run": { type: "boolean", default: false, description: "Prints which modifications will be made with current config options, but doesn't actually make any changes" },
    "dangerous-clean-slate": { type: "boolean", default: false, description: "Deletes ALL contents of server-dir, even items in excluded with 'exclude' argument" },
    "exclude": { type: "array", default: excludeDefaults, description: "An array of glob patterns, these files will not be included in the publish/delete process" },
    "log-level": { choices: ["minimal", "standard", "verbose"], default: "standard", description: "How much information should print. minimal=only important info, standard=important info and basic file changes, verbose=print everything the script is doing" },
    "security": { choices: ["strict", "loose"], default: "loose", description: "" }
})
    .example("$0 --server ftp://samkirkland.com --username user --password pass", "")
    .help("help")
    .epilog("Read more at https://github.com/SamKirkland/FTP-Deploy-Action")
    .argv;


async function runScript() {
    await deploy(argv as IFtpDeployArguments);
}


runScript();
