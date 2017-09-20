#!/usr/bin/env node
const deploy = require("./lib/deploy-ftp.js");

if (process.argv.length !== 2) {
  console.log("Usage: cocoons-ftp\n");
  return;
}

deploy.deploySite()
  .then(serverInfo => console.log(`The site is correctly deployed with FTP in : ${serverInfo}`))
  .catch(error => `Error during the deployment with ftp : ${error}`);
