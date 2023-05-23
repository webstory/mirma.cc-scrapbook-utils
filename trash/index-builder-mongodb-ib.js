const fs = require('fs');
const toml = require('toml');
const glob = require('glob');
const moment = require('moment');
const { MongoClient } = require('mongodb');

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));
const sourceDir = config.ib.files;
const mongoClient = new MongoClient(config.db.mongodb, { useNewUrlParser: true, useUnifiedTopology: true });

(async () => {
  await mongoClient.connect();
  const db = mongoClient.db(config.db.dbname);
  const files = glob.sync(`${sourceDir}/**/index.json`);
  const totalFiles = files.length;
  let processed = 0;

  for (const file of files) {
    // Start measuring time
    const start = new Date().getTime();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const operations_pools = [];
    const operations_files = [];

    for (const key of Object.keys(data.submissions)) {
      const { submission_id, keywords, username, user_id, title, description } = data.submissions[key];
      // Tags
      const tags = keywords.map((k) => k.keyword_name.replaceAll(' ', '_'));
      tags.push(`artist:${username}`);
      // Pools
      for (const pool of data.submissions[key].pools) {
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
      for (const file of data.submissions[key].files) {
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
          pools: data.submissions[key].pools.map((p) => p.pool_id),
        };

        operations_files.push({
          updateOne: {
            filter: { provider: 'inkbunny', file_id: metadata.file_id },
            update: { $set: metadata },
            upsert: true,
          },
        });
      }
    }

    if (operations_pools.length > 0) await db.collection('pools').bulkWrite(operations_pools);
    if (operations_files.length > 0) await db.collection('files').bulkWrite(operations_files);
    const end = new Date().getTime();
    console.log(`Processed ${file} [${++processed}/${totalFiles}] - ${(end - start).toFixed(2)}ms`);
  }

  await mongoClient.close();
})();
