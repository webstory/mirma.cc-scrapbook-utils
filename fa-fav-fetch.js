const fs = require('fs');
const moment = require('moment');
const { MongoClient } = require('mongodb');
const cheerio = require('cheerio');
const axios = require('axios');
const toml = require('toml');
const md5 = require('md5');
const { delay, download, detectImageTypeAndDimensions } = require('./commons');

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));

const dataDir = config.fa.files;
const mongoClient = new MongoClient(config.db.mongodb, { useNewUrlParser: true, useUnifiedTopology: true });

const FA = 'https://www.furaffinity.net';
const Cookie = `a=${config.fa.cookie_a};b=${config.fa.cookie_b}; expires=Tue, 1-Jan-2999 03:14:07 GMT; Max-Age=2147483647; path=/; domain=.furaffinity.net; secure; HttpOnly`;

async function getSubmission(submission_id) {
  const url = `${FA}/view/${submission_id}`;
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
      retry--;
      continue;
    }
  }

  let $ = cheerio.load(sPage.data);

  let author = $('.submission-id-sub-container a strong').text();
  let image = $('#submissionImg').attr('data-fullview-src');
  let title = $('.submission-title h2').text();

  if (!image) {
    image = $('.submission-area object').attr('data');
  }

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

  description = description.split('\n').slice(3).join('\n').trim();

  try {
    metadata = {
      provider: 'furaffinity',
      submission_id,
      username: author,
      title,
      description,
      file_id: Number(filename.split('.')[0]), // PK
      file_name: filename,
      // Example Date format: Jan 4, 2017 01:50 AM
      create_timestamp: moment.utc(create_datetime, 'MMM D, YYYY hh:mm A').valueOf(),
      create_datetime,
      tags,
      full_url: image,
    };

    return metadata;
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function* fetchFavoriteSid() {
  let retry = 5;
  let nextHref = '/favorites/' + config.fa.username;

  while (retry > 0) {
    let fFav;

    try {
      fFav = await axios.get(FA + nextHref, {
        withcredentials: true,
        headers: {
          Cookie,
        },
      });
    } catch (e) {
      await delay(10000);
      retry--;
      continue;
    }

    retry = 5;

    let $ = cheerio.load(fFav.data);

    let favList = $('section#gallery-favorites figure').get();

    for (let e of favList) {
      let sidUrl = $(e).find('a:first-child').attr('href');
      let m = /\/view\/([0-9]+)\//.exec(sidUrl);

      if (m.length > 1) {
        const sid = m[1];

        yield sid;
      }
    }

    let _nextHref = $('.pagination a.button.right').attr('href');

    if (/\/favorites\/[^\/]+\/[0-9]+\/next/.test(_nextHref) && nextHref != _nextHref) {
      nextHref = _nextHref;
    } else {
      break;
    }
  }
}

async function main() {
  await mongoClient.connect();
  const db = mongoClient.db(config.db.dbname);
  const collection = db.collection('files');

  const lastDoc = await collection.findOne({ provider: 'furaffinity' }, { sort: { submission_id: -1 } });
  let lastSubmissionId = lastDoc.submission_id;

  console.log(`Fetch until ${lastSubmissionId}`);

  const maxDupCount = 10;
  let dupCount = maxDupCount;

  for await (let submissionId of fetchFavoriteSid()) {
    if (dupCount <= 0) {
      break;
    }
    await delay(1000);
    const meta = await getSubmission(submissionId);

    let destPath = `${dataDir}/${meta.username}`;
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath);
    }
    destPath = destPath + '/' + meta.file_name;
    if (fs.existsSync(destPath)) {
      console.log('File already exists');
      dupCount--;
    } else {
      dupCount = maxDupCount;
      await download(meta.full_url, destPath, { Cookie: config.Cookie });
    }

    const file = fs.readFileSync(destPath);
    const hash = md5(file);

    let imageMeta = await detectImageTypeAndDimensions(destPath);
    meta.width = imageMeta.width;
    meta.height = imageMeta.height;
    meta.mimetype = imageMeta.mime;
    meta.md5 = hash;

    console.log(meta);
    try {
      await collection.updateOne({ provider: 'furaffinity', file_id: meta.file_id }, { $set: meta }, { upsert: true });
    } catch (e) {
      console.error(e);
    }
  }

  mongoClient.close();
}

main();
