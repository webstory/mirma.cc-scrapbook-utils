import fs from 'fs';
import toml from 'toml';
import { MongoClient } from 'mongodb';

const config = toml.parse(fs.readFileSync('./config.toml', 'utf-8'));

const mongoClient = new MongoClient(config.db.mongodb);

async function main() {
  await mongoClient.connect();
  const db = mongoClient.db(config.db.dbname);

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
      {
        default_language: 'english',
        weights: { title: 10, description: 1 },
      }
    );

  await db.collection('pools').createIndex({ provider: 1, name: 1 });
  await db.collection('pools').createIndex({ provider: 1, files: 1 });
  await db.collection('pools').createIndex({ provider: 1, pool_id: 1 }, { unique: true });

  await mongoClient.close();
}

main();
