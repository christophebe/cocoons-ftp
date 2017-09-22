const PromiseFtp = require("promise-ftp");
const log = require("cocoons-util/logger").Logger;
const util = require("cocoons-util/util.js");
const defaults = require("cocoons-util/default").val;

const CONFIG_FILE = "cocoons.json";
const IGNORE_FILES = "^[.]"; // ignore hidden files

const getTargetFolder = (websiteFolder, config) => `${websiteFolder}/${config.target}`;

/**
 * deploySite - Deploy with FTP the cocoons site which is in the current folder.
 * Before calling this function, the subdirectory target should contains the generated site
 *
 * @param {String} currentFolder the folder which contains the cocoons site
 * @return {Promsise} -
 */
async function deploySite(currentFolder = process.cwd()) {
  const config = Object.assign({}, defaults, await util.readJsonFile(`${currentFolder}/${CONFIG_FILE}`));
  if (!config.ftp) {
    throw new Error("There is no ftp config into the cocoons.json file !");
  }
  const targetFolder = getTargetFolder(config);

  const ftp = new PromiseFtp();
  const serverMessage = await ftp.connect(config.ftp);
  log.info(`Connected to the FTP server :${serverMessage}`);

  await deleteAll(ftp, ".");
  return Promise.all([deployFiles(ftp, targetFolder, "."), deployHtaccess(ftp, targetFolder, ".")]);
}


/**
 * deletefiles - Delete files & subfolders on the server
 *
 * @param  {type} ftp  the ftp connection
 * @param  {type} path the path on the server
 * @return {Promise} -
 */
async function deleteAll(ftp, path) {
  const files = await ftp.list(path);
  const promises = files.map(fileInfo => deleteFileOrDir(ftp, path, fileInfo));
  return Promise.all(promises);
}


/**
 * deleteFile - Delete one file or directory
 *
 * @param  {Object} ftp The ftp connection object
 * @param  {String} parentPath the path on the server
 * @param  {json} fileInfo   The ftp info on the file or the directory
 * @return {Promise} -
 */
async function deleteFileOrDir(ftp, parentPath, fileInfo) {
  const path = `${parentPath}/${fileInfo.name}`;
  // this is a file
  if (fileInfo.type === "-") {
    return ftp.delete(path);
  }
  // this is a directory
  if (fileInfo.type === "d") {
    await deleteAll(ftp, path);
    return ftp.rmdir(path);
  }
  throw new Error(`Unsupported type for ${path}`);
}


/**
 * deploy - Deploy the files & subfolders found in the target folder
 *
 * @param  {Object} ftp The ftp connection object
 * @param  {String} path The folder from which we have to put the files & subfolders
 * @param  {String} remoteDir The remote folder in which we have to copy the files
 * @return {Promise} -
 */
async function deployFiles(ftp, path, remoteDir) {
  const files = await util.readDir(path);

  const promises = files.map(file => copyToServer(ftp, path, file, remoteDir));
  return Promise.all(promises);
}


/**
 * copyToServer - Copy a file or directoy to the FTP server
 *
 * @param  {Object} ftp The ftp connection object
 * @param  {String} parentpath The folder from which we have to put the files & subfolders
 * @param  {String} file The name of the file to copy
 * @param  {String} remoteDir The remote folder in which we have to copy the files
 * @return {Promise} -
 */
async function copyToServer(ftp, parentpath, file, remoteDir) {
  if (file.match(IGNORE_FILES)) {
    return Promise.resolve("ignored");
  }

  const from = `${parentpath}/${file}`;
  const to = `${remoteDir}/${file}`;
  const stats = await util.stat(from);
  if (stats.isFile()) {
    return ftp.put(from, to);
  }
  if (stats.isDirectory()) {
    await ftp.mkdir(to);
    return deployFiles(ftp, from, to);
  }
  return Promise.resolve(`Ignore :${from}`);
}

/**
 * deployHtaccess - description
 *
 * @param  {Object} ftp The ftp connection object
 * @param  {String} target the target folder that contains the htaccess file
 * @return {Promise} -
 */
async function deployHtaccess(ftp, target) {
  ftp.put(`${target}/.htaccess`)
    .then(() => "deployed")
    .catch(() => "ignored"); // probably that the .htaccess doesn't exist for this site
}


exports.deploySite = deploySite;
