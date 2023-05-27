const fs = require('fs');
const path = require('path');
const glob = require('glob');
const toml = require('toml');
const moment = require('moment');

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));
const sourceDir = config.files.dir + 'inkbunny';
const outDir = config.files.dir + 'inkbunny-meta';

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
    tags.push(`artist:${username.toLowerCase()}`);
    // Pools
    for (const pool of data.submissions[key].pools) {
      const { pool_id, name, description } = pool;
      if (!poolMap.has(pool_id)) {
        poolMap.set(pool_id, new Set());
        poolMetadataMap.set(pool_id, { name, description });
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
    }
  }
});

tagMap.forEach((value, key) => {
  if (value.size <= 1) return;

  value = [...value].sort((a, b) => a - b);
  key = key.replaceAll('/', '⁄');

  const buffer = Buffer.alloc(4 * value.length);
  value.forEach((v, i) => buffer.writeUInt32LE(v, i * 4));

  fs.writeFileSync(`${outDir}/tag/${key}.json`, JSON.stringify(value));
  fs.writeFileSync(`${outDir}/tag/${key}.bin`, buffer);
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
