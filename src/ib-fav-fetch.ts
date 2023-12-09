import 'core-js/actual';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
import { MongoClient } from 'mongodb';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import toml from 'toml';

import { retryFetch, Downloader, createThumbnail } from './common';

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));

const dataDir = path.join(config.files.dir, 'inkbunny');
const thumbnailDir = path.join(config.files.dir, 'inkbunny-thumbnails');
const mongoClient = new MongoClient(config.db.mongodb);
let db: Db;

const IB = 'https://inkbunny.net';

interface IBCredentialToken {
  sid: string;
  user_id?: string;
}

interface PoolDocument {
  provider: string;
  pool_id: number;
  name: string;
  description: string;
  files: number[];
}

async function getSubmission(token: IBCredentialToken, submission_id: string | number) {
  const { sid } = token;
  let res;

  try {
    res = await retryFetch(IB + '/api_submissions.php', {
      tryCount: 10, retryAfter: 5000, fetchOptions: {
        headers: {
          'Content-Type': 'application/json',
        },
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
      }
    });
  } catch (e) {
    return false;
  }

  const jsonBody = await res.json();

  let submission = jsonBody?.submissions?.[0];

  if (!submission) {
    return 404;
  }

  const { keywords, username, user_id, title, description } = submission;

  // Submission already exists
  if (await db.collection('files').findOne({ provider: 'inkbunny', submission_id: Number(submission_id) })) {
    return 304;
  }

  const operations_pools: AnyBulkWriteOperation<PoolDocument>[] = [];
  const operations_files = [];

  // Tags
  const tags = keywords.map((k: any) => k.keyword_name.replaceAll(' ', '_'));
  tags.push(`artist:${username.toLowerCase()}`);
  // Pools
  for (const pool of submission.pools) {
    const { pool_id, name, description } = pool;
    operations_pools.push({
      updateOne: {
        filter: { provider: 'inkbunny', pool_id: Number(pool_id) },
        update: {
          $set: { provider: 'inkbunny', pool_id: Number(pool_id), name, description },
          $addToSet: { files: Number(submission_id) },
        },
        upsert: true,
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
      pools: submission.pools.map((p: any) => p.pool_id),
    };

    console.log(metadata);

    try {
      const downloader = new Downloader();
      if (!fs.existsSync(path.join(dataDir, username))) {
        fs.mkdirSync(path.join(dataDir, username));
      }
      const destPath = path.join(dataDir, username, file_name);
      await downloader.download(encodeURI(file.file_url_full), destPath, {});

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

  if (operations_pools.length > 0) await db.collection<PoolDocument>('pools').bulkWrite(operations_pools);
  if (operations_files.length > 0) await db.collection('files').bulkWrite(operations_files);

  return 200;
}

async function* fetchSubmissionList(token: IBCredentialToken, searchParams: any) {
  const { sid } = token;
  let res;

  const defaultSearchParams = {
    sid: sid,
    output_mode: 'json',
    submission_ids_only: 'yes',
    submissions_per_page: 100,
  };

  // Fetch the first page(mode 1)
  res = await retryFetch(IB + '/api_search.php', {
    tryCount: 3, retryAfter: 1000, fetchOptions: {
      headers: {},
      params: {
        ...defaultSearchParams,
        ...searchParams,
        get_rid: 'yes',
      },
    }
  });

  const data = await res.json();
  let { rid, page, pages_count, results_count_all, submissions } = data;

  console.log({ pages_count, results_count_all });

  for (const submission of submissions) {
    yield submission.submission_id;
  }

  while (page <= pages_count) {
    page++;

    // Countinuous search(mode 2)
    res = await retryFetch(IB + '/api_search.php', {
      tryCount: 3, retryAfter: 1000, fetchOptions: {
        headers: {},
        params: {
          ...defaultSearchParams,
          rid: rid,
          page: page,
        },
      }
    });

    let { submissions } = await res.json();
    for (const submission of submissions) {
      yield submission.submission_id;
    }
  }
}

async function main() {
  await mongoClient.connect();
  db = mongoClient.db(config.db.dbname);
  let maxDupCount = 10;

  const searchParams = new URLSearchParams({
    username: config.ib.username,
    password: config.ib.password,
    output_mode: 'json',
  });

  let res = await fetch(IB + '/api_login.php?' + searchParams.toString(), {
    method: 'POST',
    headers: {},
  });

  const token = res.body ? await res.json() : null;
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
