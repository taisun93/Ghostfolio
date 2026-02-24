// Use system browser to avoid Puppeteer Chromium download
const fs = require('fs');
const chromePath = (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const executablePath = fs.existsSync(chromePath) ? chromePath : edgePath;

module.exports = {
  launch_options: {
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
};
