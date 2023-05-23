const fs = require('fs');
const glob = require('glob');
const moment = require('moment');
const _ = require('lodash');
const axios = require('axios');
const cheerio = require('cheerio');
const toml = require('toml');
const mime = require('mime/lite');
const md5 = require('md5');
const sharp = require('sharp');
const { MongoClient } = require('mongodb');

const config = toml.parse(fs.readFileSync('.env.toml', 'utf8'));
const Cookie = config.fa.Cookie;

const sourceDir = process.cwd() + '/res/fa';
const mongoClient = new MongoClient('mongodb://localhost:27017', { useNewUrlParser: true, useUnifiedTopology: true });

function delay(t) {
  return new Promise((done) => {
    setTimeout(() => {
      done();
    }, t);
  });
}

async function getSubmission(submission_id) {
  const url = `https://www.furaffinity.net/view/${submission_id}`;
  let retry = 5;
  let metadata = null;
  let sPage;
  while (retry > 0) {
    try {
      sPage = await axios.get(url, {
        withCredentials: true,
        headers: {
          Cookie,
        },
      });
      break;
    } catch (e) {
      await delay(10000);
      if (retry-- > 0) {
        continue;
      } else {
        break;
      }
    }
  }

  if (!sPage || sPage.status !== 200) {
    return null;
  }

  let $ = cheerio.load(sPage.data);

  let author = $('.submission-id-sub-container a strong').text();
  let image = $('#submissionImg').attr('data-fullview-src');
  let title = $('.submission-title h2').text();

  if (!author || !image || !title) {
    // Submission deleted
    return null;
  }

  let description = $('.submission-description').text().replace(/\n\s*/g, '\n');
  let tags = $('.tags-row .tags a')
    .map((_i, el) => $(el).text().toLowerCase().trim())
    .get();
  tags = tags.map((t) => t.replace(/\s/g, '_'));
  tags.push(`artist:${author}`);

  let create_datetime = $('div.submission-id-sub-container strong span.popup_date').attr('title');
  let filename;

  try {
    filename = image.split('/').pop();
  } catch (e) {
    console.error(e);
  }

  if (!image) {
    image = $('.submission-area object').attr('data');

    try {
      filename = image.split('/').pop();
    } catch (e) {
      console.error(e);
    }
  }

  description = description.split('\n').slice(3).join('\n').trim();

  if (!fs.existsSync(`${sourceDir}/${author}/${filename}`)) {
    // Nothing can do, abort
    return null;
  }

  try {
    // Temporary disabled for flash files
    const file = fs.readFileSync(`${sourceDir}/${author}/${filename}`);
    const hash = md5(file);
    // const sharpImage = sharp(file);
    // const imageMetadata = await sharpImage.metadata();

    metadata = {
      provider: 'furaffinity',
      submission_id,
      username: author,
      title,
      description,
      file_id: Number(filename.split('.')[0]), // PK
      file_name: filename,
      mimetype: mime.getType(filename),
      width: 0,
      height: 0,
      // mimetype: mime.getType(imageMetadata.format),
      // width: Number(imageMetadata.width),
      // height: Number(imageMetadata.height),
      md5: hash,
      // Example Date format: Jan 4, 2017 01:50 AM
      create_timestamp: moment.utc(create_datetime, 'MMM D, YYYY hh:mm A').valueOf(),
      create_datetime,
      tags,
    };

    return metadata;
  } catch (e) {
    console.error(e);
    return null;
  }
}

(async () => {
  await mongoClient.connect();
  const db = mongoClient.db('scrapbook');

  await db.collection('files').createIndex({ provider: 1, file_id: 1 }, { unique: true });
  await db.collection('files').createIndex({ tags: 1 });
  await db.collection('files').createIndex({ pools: 1 });
  await db.collection('files').createIndex({ username: 1 });
  await db.collection('files').createIndex({ user_id: 1 });
  await db.collection('files').createIndex({ provider: 1, submission_id: 1 });
  await db.collection('files').createIndex({ file_name: 1 });
  await db.collection('files').createIndex({ md5: 1 });
  await db.collection('files').createIndex({ create_timestamp: 1 });
  await db
    .collection('files')
    .createIndex(
      { title: 'text', description: 'text' },
      { default_language: 'english' },
      { weights: { title: 10, description: 1 } }
    );

  await db.collection('pools').createIndex({ provider: 1, name: 1 });
  await db.collection('pools').createIndex({ provider: 1, files: 1 });
  await db.collection('pools').createIndex({ provider: 1, pool_id: 1 }, { unique: true });

  const files = glob.sync(`${sourceDir}/**/index.json`);
  const totalFiles = files.length;
  let processed = 0;

  for (const file of files) {
    // Start measuring time
    const start = new Date().getTime();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));

    for (const key of Object.keys(data.submissions)) {
      const operations_files = [];
      const submission_id = Number(key);

      const existing = await db.collection('files').findOne({ provider: 'furaffinity', submission_id });
      if (existing && existing.md5 /*&& existing.width*/) {
        console.log(`Skipping ${submission_id} (${processed}/${totalFiles})`);
        continue;
      }

      await delay(1000);
      console.log(`Processing ${submission_id} (${processed}/${totalFiles})`);
      let metadata = await getSubmission(submission_id);
      if (metadata) {
        operations_files.push({
          updateOne: {
            filter: { provider: 'furaffinity', file_id: metadata.file_id },
            update: { $set: metadata },
            upsert: true,
          },
        });
      } else {
        // Submission not found
        const { author, title, description, filename } = data.submissions[key];
        if (!fs.existsSync(`${sourceDir}/${author}/${filename}`)) {
          // Nothing can do, abort
          continue;
        }

        try {
          const file = fs.readFileSync(`${sourceDir}/${author}/${filename}`);
          const hash = md5(file);
          const sharpImage = sharp(file);
          const imageMetadata = await sharpImage.metadata();
          const create_datetime = fs.statSync(`${sourceDir}/${author}/${filename}`).mtime.toISOString();

          const metadata = {
            provider: 'furaffinity',
            submission_id: Number(key),
            username: author,
            title,
            description,
            file_id: Number(filename.split('.')[0]), // PK
            file_name: filename,
            mimetype: mime.getType(imageMetadata.format),
            width: Number(imageMetadata.width),
            height: Number(imageMetadata.height),
            md5: hash,
            create_timestamp: moment.utc(create_datetime).valueOf(),
            create_datetime,
            tags: [],
          };
          operations_files.push({
            updateOne: {
              filter: { provider: 'furaffinity', file_id: metadata.file_id },
              update: { $set: metadata },
              upsert: true,
            },
          });
        } catch (e) {
          console.error(e);
        }
      }
      if (operations_files.length > 0) await db.collection('files').bulkWrite(operations_files);
    }

    const end = new Date().getTime();
    console.log(`Processed ${file} [${++processed}/${totalFiles}] - ${(end - start).toFixed(2)}ms`);
  }

  await mongoClient.close();
})();
