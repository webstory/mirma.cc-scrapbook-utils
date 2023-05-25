const fs = require('fs');
const { MongoClient } = require('mongodb');
const toml = require('toml');

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));
const mongoClient = new MongoClient(config.db.mongodb, { useNewUrlParser: true, useUnifiedTopology: true });

async function main() {
  await mongoClient.connect();
  const db = mongoClient.db(config.db.dbname);
  db.collection('files')
    .find({})
    .forEach((doc) => {
      const lowercaseTags = doc.tags.map((t) => t.toLowerCase());

      db.collection('files').updateOne({ _id: doc._id }, { $set: { tags: lowercaseTags } });
    });
}

main();
