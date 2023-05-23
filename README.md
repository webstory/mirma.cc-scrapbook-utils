# Furry site favorite scraper

This is a simple script that scrapes your favorites from furry sites and stores them in a local FileSystem. Submission metadata is stored into the MongoDB database.

## Supported sites

- [x] Inkbunny
- [x] FurAffinity

## Installation

Before installing, make sure your MongoDB server is running.

### Using MongoDB Atlas

Visit [https://www.mongodb.com/atlas/database](https://www.mongodb.com/atlas/database) and create your Database

Copy connection string into the `config.toml` file. See `config.toml.example` for example.

```toml
[db]
mongodb = "mongodb+srv://<username>:<password>@my-serverlessinst.e2esljd.mongodb.net/"
dbname = "scrapbook"
```

![Database Deployments Cloud Atlas](./docs/Database%20Deployments%20Cloud%20MongoDB%20Cloud.png)

### Initializing the database

To create Index, run this command

```bash
npm install
node init-db.js
```

## Usage

### Inkbunny

#### Configuration

1. Create a file named `config.toml` in the root directory of this project.
2. Copy the contents of `config.toml.example` into `config.toml`.
3. Edit `[ib]` section of `config.toml`
   - `username`: Your IB username
   - `password`: Your IB password

### Running

```bash
node ib-fav-fetch.js
```

### FurAffinity

#### Configuration

1. Create a file named `config.toml` in the root directory of this project.
2. Copy the contents of `config.toml.example` into `config.toml`.
3. Edit `[fa]` section of `config.toml`
   - `username`: Your FA username
   - `cookie`: Your FA cookie
     - You can get this by logging into FA, opening the developer tools, and copying the value of the `a` and `b` cookie.
     - ![FA cookie](./docs/cookie-capture.png)

#### Running

```bash
node fa-fav-fetch.js
```

## License

MIT
