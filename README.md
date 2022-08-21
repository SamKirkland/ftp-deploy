# ftp deploy 🚀

Syncs a local folder with a remote folder over ftp.

After the initial sync only differences are synced, making deployments super fast!

[![Latest Stable Version](https://img.shields.io/npm/v/@samkirkland/ftp-deploy.svg?style=flat-square)](https://www.npmjs.com/package/@samkirkland/ftp-deploy)
[![NPM Downloads](https://img.shields.io/npm/dt/@samkirkland/ftp-deploy.svg?style=flat-square)](https://www.npmjs.com/package/@samkirkland/ftp-deploy)

---

## How to Run
#### Option 1 - Run via command line
- Install the npm package using `npm install @samkirkland/ftp-deploy --only=dev`
- Run via command line `ftp-deploy --server ftp.samkirkland.com --username test@samkirkland.com --password \"CrazyUniquePassword&%123\"`

- **Or you can add a script to make deployments easier**
- Add a new key to your `package.json` file under `scripts` section. See example below.
- You can run the script using the following command `npm run deploy` (run this in the folder that has the `package.json` file)

Example of `package.json`:
```json
{
  "scripts": {
    "deploy": "ftp-deploy --server ftp.samkirkland.com --username test@samkirkland.com --password \"CrazyUniquePassword&%123\"",
  },
}
```

#### Option 2 - Run programmatically
- Install the npm package using `npm install @samkirkland/ftp-deploy --only=dev`
- Import the code and use it in your code

Example of `myCustomDeployment.js`:
```javascript
import { deploy, excludeDefaults } from "@samkirkland/ftp-deploy";

async function deployMyCode() {
  console.log("🚚 Deploy started");
  await deploy({
    server: "ftp.samkirkland.com",
    username: "username@samkirkland.com",
    password: `CrazyUniquePassword&%123`, // note: I'm using backticks here ` so I don't have to escape quotes
    exclude: [...excludeDefaults, "dontDeployThisFolder/**"] // excludeDefaults will exclude .git files and node_modules
  });
  console.log("🚀 Deploy done!");
}

deployMyCode();

```

### Automatically Deploying
If you use github as source control you can automatically re-deploy your site on every git commit. [Read more](https://github.com/SamKirkland/FTP-Deploy-Action)

---

## Settings

To list all commands with examples simply run `ftp-deploy` without any options.

| Key Name                  | Required | Example                    | Default Value                                 | Description                                                                                                                                                        |
|---------------------------|----------|----------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--server`                | Yes      | `ftp.samkirkland.com`      |                                               | Deployment destination server                                                                                                                                      |
| `--username`              | Yes      | `username@samkirkland.com` |                                               | ftp username                                                                                                                                                       |
| `--password`              | Yes      | `CrazyUniquePassword&%123` |                                               | ftp password, be sure to escape quotes and spaces                                                                                                                  |
| `--port`                  | No       | `990`                      | `21`                                          | Server port to connect to (read your web hosts docs)                                                                                                               |
| `--protocol`              | No       | `ftps`                     | `ftp`                                         | `ftp`: provides no encryption, `ftps`: full encryption newest standard (aka "explicit" ftps), `ftps-legacy`: full encryption legacy standard (aka "implicit" ftps) |
| `--local-dir`             | No       | `./myFolderToPublish/`     | `./`                                          | Path to upload to on the server, must end with trailing slash `/`                                                                                                  |
| `--server-dir`            | No       | `ftp.samkirkland.com/`     | `./`                                          | Folder to upload from, must end with trailing slash `/`                                                                                                            |
| `--state-name`            | No       | `folder/.sync-state.json`  | `.ftp-deploy-sync-state.json`                 | ftp-deploy uses this file to track what's been deployed already, so only differences can be published. If you don't like the name or location you can customize it |
| `--dry-run`               | No       | `true`                     | `false`                                       | Prints which modifications will be made with current config options, but doesn't actually make any changes                                                         |
| `--dangerous-clean-slate` | No       | `true`                     | `false`                                       | Deletes ALL contents of server-dir, even items marked as `--exclude` argument                                                                                      |
| `--exclude`               | No       | `nuclearLaunchCodes.txt`   | `**/.git*` `**/.git*/**` `**/node_modules/**` | An array of glob patterns, these files will not be included in the publish/delete process                                                                          |
| `--log-level`             | No       | `info`                     | `info`                                        | `minimal`: only important info, `standard`: important info and basic file changes, `verbose`: print everything the script is doing                                 |
| `--security`              | No       | `strict`                   | `loose`                                       | `strict`: Reject any connection which is not authorized with the list of supplied CAs. `loose`: Allow connection even when the domain is not in certificate        |
| `--timeout`               | No       | `60000`                    | `30000`                                       | Timeout in milliseconds for FTP operations                                                                                                                         |
