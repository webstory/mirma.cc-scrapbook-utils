const fs = require('fs');
const axios = require('axios');
const toml = require('toml');

const config = toml.parse(fs.readFileSync('config.toml', 'utf-8'));

async function main() {
  const response = await axios.get('https://www.furaffinity.net/view/38229180', {
    withCredentials: true,
    headers: {
      Cookie: `a=${config.fa.cookie_a};b=${config.fa.cookie_b}; expires=Tue, 1-Jan-2999 03:14:07 GMT; Max-Age=2147483647; path=/; domain=.furaffinity.net; secure; HttpOnly`,
    },
  });

  if (/This submission contains Mature or Adult content/.test(response.data)) {
    console.log('fail');
  } else if (
    /<img id="submissionImg" title="Click to change the View" alt=".*?" data-fullview-src="/.test(response.data)
  ) {
    console.log('success');
  } else {
    console.log(response.data);
  }
}

main();
