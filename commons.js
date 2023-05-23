const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const FileType = require('file-type-cjs');
const imageSize = require('image-size');

function delay(t) {
  return new Promise((done) => {
    setTimeout(() => {
      done();
    }, t);
  });
}

async function download(url, path, options) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    headers: options.headers,
  });

  const writer = fs.createWriteStream(path);

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function detectImageTypeAndDimensions(filename) {
  const buffer = fs.readFileSync(filename);
  const type = await FileType.fromBuffer(buffer);

  if (!type) {
    return null;
  }

  let width = 0;
  let height = 0;
  try {
    const dimensions = imageSize(buffer);
    width = dimensions.width;
    height = dimensions.height;
  } catch (e) {
    // Do nothing
  }

  return {
    type: type.ext,
    mime: type.mime,
    width,
    height,
  };
}

/**
 * @see https://bakjuna.tistory.com/96
 * @param {number} tryCount
 * @param {number} timeInterval
 * @param {any} axiosOptions
 */
function retryAxios(tryCount, timeInterval, axiosOptions) {
  const defaultOptions = {
    responseType: 'json',
    headers: {
      'content-type': 'application/json',
    },
  };

  let failCount = 0;
  const options = _.merge(defaultOptions, axiosOptions);
  const instance = axios.create(options);

  const onFulfilled = (response) => response;
  const retry = (errConfig) => {
    return new Promise(async (resolve) => {
      await delay(timeInterval);
      resolve(instance[errConfig.method](errConfig.url));
    });
  };

  const onRejected = (error) => {
    if (error.config) {
      failCount++;
      if (failCount <= tryCount) {
        console.error(`[Error] Retrying ${failCount}/${tryCount} after ${timeInterval}ms...`);
        return retry(error.config);
      }
    }
    return Promise.reject(error);
  };

  instance.interceptors.response.use(onFulfilled, onRejected);

  return instance;
}

module.exports = {
  delay,
  download,
  detectImageTypeAndDimensions,
  retryAxios,
};
