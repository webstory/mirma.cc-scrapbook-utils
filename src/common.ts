import fs from 'fs';
import path from 'path';
import mime from 'mime';
import imageSize from 'image-size';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';

import { EventEmitter } from 'events';

/// Type definitions
export interface DownloadOptions {
  headers?: HeadersInit;
  params?: Record<string, string>;
}

/// Exports
export function delay(t: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(() => {
      done();
    }, t);
  });
}

export class Downloader extends EventEmitter {
  async download(url: string, path: string, options: DownloadOptions = {}): Promise<void> {
    let fullURL = url;
    if (options.params) {
      const params = new URLSearchParams(options.params);
      fullURL += '?' + params.toString();
    }

    const response = await fetch(fullURL, {
      method: 'GET',
      headers: options.headers || {},
    });

    if (!response.ok) {
      return new Promise((resolve, reject) => {
        reject(response.statusText);
      });
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = Number(contentLength) || 0;
    let receivedBytes = 0;

    const writer = fs.createWriteStream(path);

    return new Promise((resolve, reject) => {
      if (!response.body) {
        return reject('No response body');
      }
      const reader = response.body.getReader();
      const processResult = ({ done, value }: ReadableStreamReadResult<Uint8Array>): void => {
        if (done) {
          writer.end();
          resolve();
          return;
        }

        writer.write(Buffer.from(value));
        receivedBytes += value.length;
        this.emit('progress', receivedBytes, totalBytes);

        reader.read().then(processResult);
        return;
      }

      reader.read().then(processResult);
    });
  }
}

export async function detectImageTypeAndDimensions(filename: string) {
  const { fileTypeFromBuffer } = await import('file-type');
  const buffer = fs.readFileSync(filename);
  const type = await fileTypeFromBuffer(buffer);

  if (!type) {
    return null;
  }

  let width = 0;
  let height = 0;
  try {
    const dimensions = imageSize(buffer);
    width = dimensions.width || 0;
    height = dimensions.height || 0;
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

interface RetryFetchOptions extends RequestInit {
  params?: Record<string, any>;
}

export function retryFetch(url: string, options: { tryCount: number, retryAfter: number, fetchOptions?: RetryFetchOptions }): Promise<Response> {
  const defaultOptions: RequestInit = {
    headers: {
      'content-type': 'application/json',
    },
  };
  const { tryCount, retryAfter: timeInterval, fetchOptions } = options;

  let failCount = 0;
  const _options = { ...defaultOptions, ...fetchOptions };

  const fetchData = async (url: string, config: RequestInit): Promise<Response> => {
    try {
      const response = await fetch(url, config);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      failCount++;
      if (failCount <= tryCount) {
        console.error(`[Error] Retrying ${failCount}/${tryCount} after ${timeInterval}ms...`);
        await delay(timeInterval);
        return fetchData(url, config);
      } else {
        throw error;
      }
    }
  };

  let fullURL = url;
  if (_options.params) {
    const params = new URLSearchParams(_options.params);
    fullURL += '?' + params.toString();
  }

  return fetchData(fullURL, _options);
}

export async function createImageThumbnail(inputPath: string, outputPath: string) {
  if (fs.existsSync(outputPath)) {
    console.log('Thumbnail already exists, skipping');
    return;
  }

  try {
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath));
    }
    const img = sharp(inputPath);
    const resizedImg = img.resize({ width: 120, height: 120, fit: sharp.fit.inside, withoutEnlargement: true });
    await resizedImg.toFile(outputPath);
  } catch (e) {
    console.error(e);
  }
}

export async function createVideoThumbnail(inputPath: string, outputPath: string) {
  // Override thumbnail extension to png
  outputPath = outputPath.replace(/\.[^/.]+$/, '.png');

  if (fs.existsSync(outputPath)) {
    console.log('Thumbnail already exists, skipping');
    return;
  }

  try {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .on('end', resolve)
        .on('error', reject)
        .screenshots({
          timestamps: ['50%'],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '120x120',
        });
    });
  } catch (e) {
    console.error(e);
    return;
  }
}

export async function createThumbnail(inputPath: string, outputPath: string) {
  const mimeType = mime.getType(inputPath) || 'application/octet-stream';
  if (mimeType.startsWith('image/')) {
    return createImageThumbnail(inputPath, outputPath);
  } else if (mimeType.startsWith('video/')) {
    return createVideoThumbnail(inputPath, outputPath);
  } else {
    throw new Error(`Cannot determine mimetype`);
  }
}
