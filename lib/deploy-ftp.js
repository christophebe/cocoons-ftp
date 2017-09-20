var fs           = require('graceful-fs');
var rimraf       = require('rimraf');
var async        = require('async');
var pt           = require('path');
var log          = require('../logger').Logger;
var util         = require('../util.js');
var ftpUtil      = require('../util-ftp.js');


var TARGET_FOLDER = "target";


/**
 * Public method of this component.
 *
 * Send the files & folders of the website to a web server by using FTP
 *
 * 1. Read the cocoons.json config file in the current directory
 * 2. Connect to the FTP server
 * 3. Start the depoyment of the site
 *
 *
 */
var deploySite = function(callback) {

  configFile = process.cwd() + "/cocoons.json";
  init(configFile, function(error, config){
      if (error) {
          callback(new Error("Impossible to start the deployment of the site : " + error));
          return;
      }

      if (! config.ftp) {
        callback(new Error("There is no ftp config into the cocoons.json file !"));
        return;
      }

      log.info("Deploy the web site from the target folder : " + config.targetFolder);

      connectFtpClient(config, function(error, ftpClient) {
          if (error) {
            callback(error);
            return;
          }
          else {
            log.info("Connexion looks good!");
          }

          config.ftpClient = ftpClient;
          log.info("Starting deployment ...");
          deployAll(config, callback);


      });


  });


}

/**
 * Read the cocoons.json file
 *
 * @param path of the cocoons.json file
 * @param callback(error, config)
 *      - error if it is not possible to read the config file
 *      - the config object matching to the cocoons.json file
 *
 */
var init = function(configFile, callback) {

    util.readJsonFile(configFile, function(error, config){
      if (! error) {
          config.dirname = process.cwd();
          config.targetFolder = process.cwd() + "/" + TARGET_FOLDER;
          config.ignoreFiles = ["^[.]"]; // ignore hidden files
      }
      callback(error, config);

    })


}

/**
 * Connect to the FTP Server
 *
 * @param the json object that match to the cocoons.json file
 * @param callback(error, ftpClient)
 */
var connectFtpClient = function(config, callback) {

  var ftpClient = new ftpUtil.FtpClient(config.ftp);
  ftpClient.connect(function(error) {
      if (error) {
        callback(error);
      }
      else {
        callback(null, ftpClient);
      }
  });

}


/**
 * Start the deployment of the site :
 * 1. if required, delete the remote files & folders
 * 2. Deploy the local files found in the target folder of the project
 *
 * @param
 * @returns
 */
var deployAll = function(config, endCallback) {

    async.waterfall([
        function(callback){
            deleteExistingFiles(config, callback);
        },
        function(callback){
          deployFiles(config, callback);
        }

    ], function (error, result) {

          config.ftpClient.disconnect(function(error){
              var ftpServerInfo = config.ftp.host + ":" + config.ftp.port;
              if (config.ftp.folder) {
                ftpServerInfo += " folder : " + config.ftp.folder;
              }
              endCallback(error, ftpServerInfo);
          });
    });

}

/**
 * Delete remote files & folders
 *
 * @param the json object that match to the cocoons.json file
 * @param callback(error)
 */
var deleteExistingFiles = function(config, callback) {
    if (config.ftp.deleteExistingfiles) {
        config.ftpClient.deleteAll(".", function(error){
          callback(error);
        });
    }
    else {
      callback();
    }
}


/**
 * Deploy files and folders found in the target folder of the project
 * 1. Deploy the htaccess which is the only hidden file to deploy
 * 2. Deploy all non hidden files & folders
 *
 * @param the json object that match to the cocoons.json file
 * @param callback(error)
 * @returns
 */
var deployFiles = function(config, endCallback) {
    async.series([
        function(callback){
          deployHtaccess(config, callback);
        },
        function(callback){
          deployTargetDir(config, config.targetFolder, ".", callback);
        }
    ],
    function(error){
        endCallback(error);
    });

}

/**
 * Deploy the htaccess file
 *
 * @param the json object that match to the cocoons.json file
 * @param callback(error)
 */
var deployHtaccess = function (config, callback) {
  if (config.htaccess.generate) {
    log.info("Send the htaccess :" + config.targetFolder + "/.htaccess");
    config.ftpClient.sendFile(config.targetFolder + "/.htaccess", ".htaccess", callback)
  }
}

/**
 * Read the target directory in order to send its files & subdirectories
 * to the ftp server
 *
 * @param the json object that match to the cocoons.json file
 * @param the path of the target folder
 * @param the remote directory in which we will deploy the files & subfolders
 * @param callback(error)
 */
var deployTargetDir = function (config, path, remoteDir, endCallback) {

  fs.readdir(path, function(error, files){

    if (error) {
      endCallback(new Error ("Impossible to read the target folder : " + path));
      return;
    }

    async.eachSeries(files,
        function(file, callback) {

            if (! hasToIgnore(config, file)) {
              var from = path + "/" + file;
              var to = remoteDir + "/" + file;
              sendToServer(config, from, to, callback);
            }
            else {
              callback();
            }
        },
        function(error) {
            endCallback(error, config.ftp.folder);
        }
    );

  });
}

/**
 * Check if a file has been to ignore (not send to the ftp server)
 *
 * @param the json object that match to the cocoons.json file
 * @param the file path to check
 * @returns true if the file has to be ignored
 */
var hasToIgnore = function(config, file) {
    for (i=0; i< config.ignoreFiles.length; i++) {
      if (file.match(config.ignoreFiles[i])) {
        log.debug("Ignore file : " + file);
        return true;
      }
    }
    return false;
}

/**
 * Send a file or a directory from the site target folder into
 * the ftp server
 *
 * @param the json object that match to the cocoons.json file
 * @param the local file/directory path
 * @param the name of the remote file or directory
 * @param the remote directory in which we will add the file or the subdirectory
 * @param callback(error)
 *
 */
var sendToServer = function(config, from, to, callback) {


    fs.stat(from, function(error, stats) {
      if (error) {
        log.error("Error during the file stat : " + error);
        callback(error);
        return;
      }

      if (stats.isFile()) {
          log.info("Send file : " + from + " => " + to);
          config.ftpClient.sendFile(from, to,  callback);
          return;
      }

      if (stats.isDirectory()) {
          log.info("Create directory : " + from + " => " + to);
          config.ftpClient.createDir(to, function(error){
            deployTargetDir(config, from, to, callback);
          });

      }
    });

}




exports.deploySite = deploySite;
