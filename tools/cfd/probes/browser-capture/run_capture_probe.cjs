// Local synthetic P6 probe. No servers, network requests, or product iframe interaction.
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');

async function main() {
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes('--playwright-root') || !args.includes('--out-dir')) {
    throw new Error('Usage: node run_capture_probe.cjs --playwright-root <viewer dir> --out-dir <scratch dir>');
  }
  const localRequire = createRequire(path.resolve(value('--playwright-root'),'package.json'));
  const {chromium} = localRequire('playwright');
  const out = path.resolve(value('--out-dir')); fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
    const evidence = await page.evaluate(() => window.runProbe());
    for (const artifact of evidence.artifacts) {
      fs.writeFileSync(path.join(out,artifact.name), Buffer.from(artifact.data_url.split(',')[1],'base64'));
    }
    evidence.artifacts = evidence.artifacts.map(({name}) => ({name}));
    evidence.browser_version = browser.version();
    fs.writeFileSync(path.join(out,'probe_browser_capture.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence,null,2));
    if (evidence.verdict !== 'PASS') process.exitCode = 1;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
