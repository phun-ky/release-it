import fs, { close, openSync, statSync, utimesSync, accessSync } from 'node:fs'; // need import fs here due to test stubbing
import util from 'node:util';
import { EOL } from 'node:os';
import _ from 'lodash';
import gitUrlParse from 'git-url-parse';
import semver from 'semver';
import osName from 'os-name';
import Log from './log.js';

export const execOpts = {
  stdio: process.env.NODE_DEBUG && process.env.NODE_DEBUG.indexOf('release-it') === 0 ? 'pipe' : []
};

const debug = util.debug('release-it:shell');

const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const pkg = readJSON(new URL('../package.json', import.meta.url));

const log = new Log();

const getSystemInfo = () => {
  return {
    'release-it': pkg.version,
    node: process.version,
    os: osName()
  };
};

const format = (template = '', context = {}) => {
  try {
    return _.template(template)(context);
  } catch (error) {
    log.error(`Unable to render template with context:\n${template}\n${JSON.stringify(context)}`);
    log.error(error);
    throw error;
  }
};

const truncateLines = (input, maxLines = 10, surplusText = null) => {
  const lines = input.split(EOL);
  const surplus = lines.length - maxLines;
  const output = lines.slice(0, maxLines).join(EOL);
  return surplus > 0 ? (surplusText ? `${output}${surplusText}` : `${output}${EOL}...and ${surplus} more`) : output;
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const rejectAfter = (ms, error) =>
  wait(ms).then(() => {
    throw error;
  });

const parseGitUrl = remoteUrl => {
  if (!remoteUrl) return { host: null, owner: null, project: null, protocol: null, remote: null, repository: null };
  const normalizedUrl = (remoteUrl || '')
    .replace(/^[A-Z]:\\\\/, 'file://') // Assume file protocol for Windows drive letters
    .replace(/^\//, 'file://') // Assume file protocol if only /path is given
    .replace(/\\+/g, '/'); // Replace forward with backslashes
  const parsedUrl = gitUrlParse(normalizedUrl);
  const { resource: host, name: project, protocol, href: remote } = parsedUrl;
  const owner = protocol === 'file' ? _.last(parsedUrl.owner.split('/')) : parsedUrl.owner; // Fix owner for file protocol
  const repository = `${owner}/${project}`;
  return { host, owner, project, protocol, remote, repository };
};

const reduceUntil = async (collection, fn) => {
  let result;
  for (const item of collection) {
    if (result) break;
    result = await fn(item);
  }
  return result;
};

const hasAccess = path => {
  try {
    accessSync(path);
    return true;
  } catch (err) {
    return false;
  }
};

const parseVersion = raw => {
  if (raw == null) return { version: raw, isPreRelease: false, preReleaseId: null };
  const version = semver.valid(raw) ? raw : semver.coerce(raw);
  if (!version) return { version: raw, isPreRelease: false, preReleaseId: null };
  const parsed = semver.parse(version);
  const isPreRelease = parsed.prerelease.length > 0;
  const preReleaseId = isPreRelease && isNaN(parsed.prerelease[0]) ? parsed.prerelease[0] : null;
  return {
    version: version.toString(),
    isPreRelease,
    preReleaseId
  };
};

const e = (message, docs, fail = true) => {
  const error = new Error(docs ? `${message}${EOL}Documentation: ${docs}${EOL}` : message);
  error.code = fail ? 1 : 0;
  error.cause = fail ? 'ERROR' : 'INFO';
  return error;
};

const touch = (path, callback) => {
  const stat = tryStatFile(path);
  if (stat && stat.isDirectory()) {
    // don't error just exit
    return;
  }

  const fd = openSync(path, 'a');
  close(fd);
  const now = new Date();
  const mtime = now;
  const atime = now;
  utimesSync(path, atime, mtime);
  if (callback) {
    callback();
  }
};

const tryStatFile = filePath => {
  try {
    return statSync(filePath);
  } catch (e) {
    debug(e);
    return null;
  }
};

const fixArgs = args => (args ? (typeof args === 'string' ? args.split(' ') : args) : []);

export {
  getSystemInfo,
  format,
  truncateLines,
  rejectAfter,
  reduceUntil,
  parseGitUrl,
  hasAccess,
  parseVersion,
  readJSON,
  fixArgs,
  e,
  touch
};
