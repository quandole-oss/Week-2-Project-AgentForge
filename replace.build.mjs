import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { replaceInFileSync } from 'replace-in-file';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: resolve(__dirname, '.env')
});

const now = new Date();
const buildTimestamp = `${formatWithTwoDigits(
  now.getDate()
)}.${formatWithTwoDigits(
  now.getMonth() + 1
)}.${now.getFullYear()} ${formatWithTwoDigits(
  now.getHours()
)}:${formatWithTwoDigits(now.getMinutes())}`;

try {
  const changedFiles = replaceInFileSync({
    files: './dist/apps/client/main.*.js',
    from: /{BUILD_TIMESTAMP}/g,
    to: buildTimestamp,
    allowEmptyPaths: false
  });
  console.log('Build version set: ' + buildTimestamp);
  console.log(changedFiles);
} catch (error) {
  console.error('Error occurred:', error);
}

// Fix path embedding when project folder contains " (e.g. Week 2 Project "AgentForge")
try {
  const pathFixFiles = replaceInFileSync({
    files: './dist/apps/client/**/*.js',
    from: /"AgentForge"/g,
    to: '\\"AgentForge\\"',
    allowEmptyPaths: true
  });
  if (pathFixFiles?.length) {
    console.log('Path quote escaped in', pathFixFiles.length, 'client JS file(s)');
  }
} catch (pathErr) {
  console.warn('Path-escape step skipped:', pathErr.message);
}

function formatWithTwoDigits(aNumber) {
  return aNumber < 10 ? '0' + aNumber : aNumber;
}
