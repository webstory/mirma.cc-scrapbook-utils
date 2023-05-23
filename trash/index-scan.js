const fs = require('fs');
const path = require('path');
const glob = require('glob');
const toml = require('toml');
const moment = require('moment');
const sqlite3 = require('sqlite3').verbose();

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));
const sourceDir = config.ib.files;
const outDir = config.ib.meta_files;

const db = new sqlite3.Database(path.join(outDir, 'ib.db'));

db.serialize(() => {
  // Drop Tables
  db.run('DROP TABLE IF EXISTS files');
  db.run('DROP TABLE IF EXISTS pools');

  // Create Tables
  db.run(
    'CREATE TABLE IF NOT EXISTS files (file_id INTEGER PRIMARY KEY, submission_id INTEGER, user_id INTEGER, username TEXT, title TEXT, description TEXT, file_name TEXT, mimetype TEXT, width INTEGER, height INTEGER, md5 TEXT, create_timestamp INTEGER, create_datetime TEXT, tags TEXT, pools TEXT)'
  );
  db.run('CREATE TABLE IF NOT EXISTS pools (pool_id INTEGER PRIMARY KEY, name TEXT, description TEXT, files TEXT)');

  // Truncate Tables
  db.run('DELETE FROM files');
  db.run('DELETE FROM pools');
});

const files = glob.sync(`${sourceDir}/**/index.json`);

const tagMap = new Map();
const poolMap = new Map();
const poolMetadataMap = new Map();

files.forEach(async (file) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  for (const key of Object.keys(data.submissions)) {
    const { submission_id, keywords, username, user_id, title, description } = data.submissions[key];
    // Tags
    const tags = keywords.map((k) => k.keyword_name.replaceAll(' ', '_'));
    tags.push(`artist:${username}`);
    // Pools
    for (const pool of data.submissions[key].pools) {
      const { pool_id, name, description } = pool;
      if (!poolMap.has(pool_id)) {
        poolMap.set(pool_id, new Set());
        poolMetadataMap.set(pool_id, { name, description });
        db.run(`INSERT INTO pools (pool_id, name, description) VALUES (?,?,?)`, [pool_id, name, description]);
      }
      poolMap.get(pool_id).add(Number(submission_id));
    }
    // Files
    for (const file of data.submissions[key].files) {
      const { file_id, file_name, mimetype, full_size_x, full_size_y, full_file_md5, create_datetime } = file;
      tags.forEach((tag) => {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, new Set());
        }
        tagMap.get(tag).add(Number(file_id));
      });

      // Create File metadata
      const metadata = {
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

      // Insert File metadata into the files table
      db.run(
        `INSERT INTO files (submission_id, user_id, username, title, description, file_id, file_name, mimetype, width, height, md5, create_timestamp, create_datetime, tags, pools) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          metadata.submission_id,
          metadata.user_id,
          metadata.username,
          metadata.title,
          metadata.description,
          metadata.file_id,
          metadata.file_name,
          metadata.mimetype,
          metadata.width,
          metadata.height,
          metadata.md5,
          metadata.create_timestamp,
          metadata.create_datetime,
          metadata.tags.join(','),
          metadata.pools.join(','),
        ]
      );
    }
  }
});

tagMap.forEach((value, key) => {
  if (value.size <= 1) return;

  value = [...value].sort((a, b) => a - b);
  key = key.replaceAll('/', '⁄');

  fs.writeFileSync(`${outDir}/tag/${key}.json`, JSON.stringify(value));
});

poolMap.forEach((value, key) => {
  value = [...value].sort((a, b) => a - b);
  key = key.replaceAll('/', '⁄');

  fs.writeFileSync(
    `${outDir}/pool/${key}.json`,
    JSON.stringify({
      pool_id: key,
      name: poolMetadataMap.get(key).name,
      description: poolMetadataMap.get(key).description,
      files: value,
    })
  );
});

db.serialize(() => {
  // Create Indexes
  db.run('CREATE INDEX IF NOT EXISTS files_user_id ON files (user_id)');
  db.run('CREATE INDEX IF NOT EXISTS files_submission_id ON files (submission_id)');
  db.run('CREATE INDEX IF NOT EXISTS files_username ON files (username)');
  db.run('CREATE INDEX IF NOT EXISTS files_create_timestamp ON files (create_timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS files_file_name ON files (file_name)');

  db.run('CREATE INDEX IF NOT EXISTS pools_name ON pools (name)');
});

db.close();
