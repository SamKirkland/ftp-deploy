# ftp deploy 🚀

Syncs a local folder with a remote folder over ftp.

After the initial sync only differences and synced, making deployments super fast!

---

## How to Run
#### Option 1 - Command Line
- Install the npm package using `npm install @samkirkland/ftp-deploy --only=dev`
- Run via command line `npm run ftp-deploy --server ftp.samkirkland.com --username test@samkirkland.com --password \"CrazyUniquePassword&%123\"`

- **Or you can add a script to make deployments easier**
- Add a new key to your `package.json` file under `scripts`
- You can run the script using the following command `npm run deploy` (run this in the folder that has the `package.json` file)

Example of `package.json`:
```json
{
  "scripts": {
    "deploy": "ftp-deploy --server ftp.samkirkland.com --username test@samkirkland.com --password \"CrazyUniquePassword&%123\"",
  },
}
```

#### Option 2 - Code
- Install the npm package using `npm install @samkirkland/ftp-deploy --only=dev`
- Import the code and use it via normal node modules

Example of `myCustomDeployment.js`:
```js
import { deploy, excludeDefaults } from "ftp-deploy";

async function deployMyCode() {
  console.log("Deploy started");
  await deploy({
    server: "ftp.samkirkland.com",
    username: "username@samkirkland.com",
    password: `CrazyUniquePassword&%123`, // note: I'm using backticks here ` so I don't have to escape quotes
    exclude: [...excludeDefaults, "dontDeployThisFolder/**"] // excludeDefaults will exclude .git files and node_modules
  });
  console.log("Deploy done!");
}

deployMyCode();

```

### Automatically Deploying
If you use github as source control you can automatically re-deploy your site on every git commit. [Read more](https://github.com/SamKirkland/FTP-Deploy-Action)

---

## Settings

| Key Name                  | Required | Example                    | Default Value                                            | Description                                                                                                                             |
|---------------------------|----------|----------------------------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `--server`                | Yes      | `ftp.samkirkland.com`      |                                                          | Deployment destination server. Formatted as `domain.com:port`. Port is optional, when not specified it will default to 22               |
| `--username`              | Yes      | `username@samkirkland.com` |                                                          | SSH user name                                                                                                                           |
| `--password`              | Yes      | `CrazyUniquePassword&%123` |                                                          | SSH private key                                                                                                                         |
| `--local-dir`             | No       | `./myFolderToPublish/`     | `./`                                                     | Path to upload to on the server, must end with trailing slash `/`                                                                       |
| `--server-dir`            | No       | `ftp.samkirkland.com`      | `./`                                                     | Folder to upload from, must end with trailing slash `/`                                                                                 |
| `--state-name`            | No       | `folder/.sync-state.json`  | `.ftp-deploy-sync-state.json`                            | Custom                                                                                                                                  |
| `--dry-run`               | No       | `true`                     | `false`                                                  | Prints which modifications will be made with current config options, but doesn't actually make any changes                              |
| `--dangerous-clean-slate` | No       | `true`                     | `false`                                                  | Deletes ALL contents of server-dir, even items in excluded with 'exclude' argument                                                      |
| `--include`               | No       |                            | ``                                                       | An array of glob patterns, these files will always be included in the publish/delete process - even if no change occurred               |
| `--exclude`               | No       |                            | `.git*` `.git*/**` `node_modules/**` `node_modules/**/*` | An array of glob patterns, these files will not be included in the publish/delete process                                               |
| `--log-level`             | No       | `info`                     | `info`                                                   | `warn`: only important/warning info, `info`: default, log important/warning info & progress info, `debug`: log everything for debugging |
