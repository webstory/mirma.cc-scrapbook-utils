import fs from 'fs';
import { glob } from 'glob';
import toml from 'toml';
import { createThumbnail } from './common';

const config = toml.parse(fs.readFileSync('config.toml', 'utf8'));

async function main() {
  const providers = ['inkbunny', 'furaffinity'];
  const params = providers.map((p) => {
    return {
      inputDir: `${config.files.dir}/${p}`,
      outputDir: `${config.files.dir}/${p}-thumbnails`,
    };
  });

  for (const param of params) {
    if (!fs.existsSync(param.outputDir)) {
      fs.mkdirSync(param.outputDir);
    }

    const files = await glob(`**/*`, { cwd: param.inputDir, root: '', nodir: true });
    const totalFiles = files.length;
    let processed = 0;

    for (const file of files) {
      processed++;
      console.log(`[${processed}/${totalFiles}] Processing ${file}`);
      try {
        await createThumbnail(`${param.inputDir}/${file}`, `${param.outputDir}/${file}`);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

main();
