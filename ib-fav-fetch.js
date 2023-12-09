const fs = require('fs');
const path = require('path');
const moment = require('moment');
const { MongoClient } = require('mongodb');
const toml = require('toml');
const axios = require('axios');
const _ = require('lodash');
const { retryAxios, download, createThumbnail } = require('./commons');

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));

const dataDir = path.join(config.files.dir, 'inkbunny');
const thumbnailDir = path.join(config.files.dir, 'inkbunny-thumbnails');
const mongoClient = new MongoClient(config.db.mongodb);
let db;

const IB = 'https://inkbunny.net';

async function getSubmission(token, submission_id) {
  const { sid } = token;
  let res;

  try {
    res = await retryAxios(10, 5000).get(IB + '/api_submissions.php', {
      headers: {},
      params: {
        sid: sid,
        submission_ids: submission_id,
        output_mode: 'json',
        sort_keywords_by: 'alphabetical',
        show_description: 'yes',
        show_description_bbcode_parsed: 'no',
        show_writing: 'yes',
        show_writing_bbcode_parsed: 'no',
        show_pools: 'yes',
      },
    });
  } catch (e) {
    return false;
  }

  let submission = _.get(res.data, 'submissions[0]', null);

  if (!submission) {
    return 404;
  }

  const { keywords, username, user_id, title, description } = submission;

  // Submission already exists
  if (await db.collection('files').findOne({ provider: 'inkbunny', submission_id: Number(submission_id) })) {
    return 304;
  }

  const operations_pools = [];
  const operations_files = [];

  // Tags
  const tags = keywords.map((k) => k.keyword_name.replaceAll(' ', '_'));
  tags.push(`artist:${username.toLowerCase()}`);
  // Pools
  for (const pool of submission.pools) {
    const { pool_id, name, description } = pool;
    operations_pools.push({
      updateOne: {
        filter: { provider: 'inkbunny', pool_id: Number(pool_id) },
        update: { $set: { provider: 'inkbunny', pool_id: Number(pool_id), name, description } },
        upsert: true,
      },
    });
    operations_pools.push({
      updateOne: {
        filter: { provider: 'inkbunny', pool_id: Number(pool_id) },
        update: { $addToSet: { files: Number(submission_id) } },
      },
    });
  }
  // Files
  for (const file of submission.files) {
    const { file_id, file_name, mimetype, full_size_x, full_size_y, full_file_md5, create_datetime } = file;

    // Create File metadata
    const metadata = {
      provider: 'inkbunny',
      submission_id: Number(submission_id),
      user_id: Number(user_id),
      username,
      title,
      description,
      file_id: Number(file_id), // PK
      file_name,
      mimetype,
      width: Number(full_size_x),
      height: Number(full_size_y),
      md5: full_file_md5,
      create_timestamp: moment.utc(create_datetime).valueOf(),
      create_datetime,
      tags,
      pools: submission.pools.map((p) => p.pool_id),
    };

    console.log(metadata);

    try {
      if (!fs.existsSync(path.join(dataDir, username))) {
        fs.mkdirSync(path.join(dataDir, username));
      }
      const destPath = path.join(dataDir, username, file_name);
      await download(encodeURI(file.file_url_full), destPath, {});

      try {
        if (!fs.existsSync(path.join(thumbnailDir, username))) {
          fs.mkdirSync(path.join(thumbnailDir, username));
        }
        const thumbnailPath = path.join(thumbnailDir, username, file_name);
        await createThumbnail(destPath, thumbnailPath);
      } catch (e) {
        console.error(e);
      }

      operations_files.push({
        updateOne: {
          filter: { provider: 'inkbunny', file_id: metadata.file_id },
          update: { $set: metadata },
          upsert: true,
        },
      });
    } catch (e) {
      console.error('Cannot find: ' + encodeURI(file.file_url_full));
    }
  }

  if (operations_pools.length > 0) await db.collection('pools').bulkWrite(operations_pools);
  if (operations_files.length > 0) await db.collection('files').bulkWrite(operations_files);

  return 200;
}

async function* fetchSubmissionList(token, searchParams) {
  const { sid } = token;
  let res;

  const defaultSearchParams = {
    sid: sid,
    output_mode: 'json',
    submission_ids_only: 'yes',
    submissions_per_page: 100,
  };

  // Fetch the first page(mode 1)
  res = await retryAxios(3, 1000).get(IB + '/api_search.php', {
    headers: {},
    params: {
      ...defaultSearchParams,
      ...searchParams,
      get_rid: 'yes',
    },
  });

  let { rid, page, pages_count, results_count_all, submissions } = res.data;

  console.log({ pages_count, results_count_all });

  for (const submission of submissions) {
    yield submission.submission_id;
  }

  while (page <= pages_count) {
    page++;

    // Countinuous search(mode 2)
    res = await retryAxios(3, 1000).get(IB + '/api_search.php', {
      headers: {},
      params: {
        ...defaultSearchParams,
        rid: rid,
        page: page,
      },
    });

    let { submissions } = res.data;
    for (const submission of submissions) {
      yield submission.submission_id;
    }
  }
}

async function main() {
  await mongoClient.connect();
  db = mongoClient.db(config.db.dbname);
  let maxDupCount = 10;

  let res = await axios.get(IB + '/api_login.php', {
    headers: {},
    params: {
      username: config.ib.username,
      password: config.ib.password,
      output_mode: 'json',
    },
  });

  const token = res.data;
  let dupCount = maxDupCount;
  let submissionList;

  submissionList = fetchSubmissionList(token, {
    favs_user_id: token.user_id,
    orderby: 'fav_datetime',
  });

  for await (const submissionId of submissionList) {
    if (dupCount < 0) {
      break;
    }
    console.log(`#${submissionId}`);

    let res = await getSubmission(token, submissionId);
    if (res !== 200) {
      dupCount--;
      if (res === 404) {
        console.log('File Not Found');
      } else if (res === 304) {
        console.log('File Already Exists');
      }
    } else {
      dupCount = maxDupCount;
    }
  }

  mongoClient.close();
}

main();
