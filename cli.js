#!/usr/bin/env node

const { join } = require('path');
const { writeFileSync, readFileSync } = require('fs');
const { copy } = require('fs-extra');
const importCwd = require('import-cwd');
const fetch = require('node-fetch');
const { Command } = require('commander');
const { inspect } = require('util');
const program = new Command();

async function list(lttfPlugins, previousResultsPath) {
  let pluginResults = {};

  for (let plugin of lttfPlugins) {
    pluginResults[plugin.name] = await plugin.import.list();
  }

  let previousResults = {}

  if (previousResultsPath) {
    if (previousResultsPath.match(/((http(s?)):\/\/)/)) {
      const response = await fetch(previousResultsPath);

      if(response.ok) {
        previousResults = await response.json();
      } else {
        console.warn(`Error ${response.status} when downloading previous results. Previous results ignored`);
      }
    } else {
      try {
        let file = readFileSync(previousResultsPath);
        previousResults = JSON.parse(file);
      } catch {
        console.warn(`Error ${previousResultsPath} could not be found. Previous results ignored`);
      }
    }
  }

  let today = new Date();
  let isoDate = today.toISOString().split('T')[0];

  previousResults[isoDate] = pluginResults;

  return previousResults;
}

async function output(lttfPlugins, outputPath, rootUrl, previousResultsPath) {
  if (!output) {
    console.error('You must provide an output directory to `output` with -o');
  }

  const ouputResult = await list(lttfPlugins, previousResultsPath);

  await copy(join(__dirname, 'dist'), outputPath);

  if(rootUrl) {
    let index = readFileSync(join(outputPath, 'index.html'), 'utf8');
    let regex = /<meta name="lint-to-the-future\/config\/environment" content="(.*)" \/>/;
    let envContentString = index.match(regex)[1];
    let envContent =  JSON.parse(decodeURIComponent(envContentString));
    envContent.rootURL = `/${rootUrl}/`;
    writeFileSync(
      join(outputPath, 'index.html'),
      index
        .replace(regex, `<meta name="lint-to-the-future/config/environment" content="${encodeURIComponent(JSON.stringify(envContent))}" />`)
        .replace(/"\/assets\//g, `"/${rootUrl}/assets/`),
    );
  }

  writeFileSync(join(outputPath, 'data.json'), JSON.stringify(ouputResult));
}

async function getLttfPlugins() {
  let currentPackageJSON = require(join(process.cwd(), 'package.json'));

  let lttfPluginsNames = [
    ...Object.keys(currentPackageJSON.devDependencies || {}),
    ...Object.keys(currentPackageJSON.dependencies || {})
  ].filter(dep => dep.startsWith('lint-to-the-future-'));

  let lttfPlugins = [];

  for (const name of lttfPluginsNames) {
    let mod;

    try {
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      mod = await import(join(process.cwd(), 'node_modules', name, 'main.mjs'));
    } catch (err) {
      // fallback to trying importCwd
      mod = importCwd(name);
    }

    lttfPlugins.push({
      import: mod,
      name,
    })
  }
  return lttfPlugins;
}

program
  .name('lint-to-the-future')
  .description('A modern way to progressively update your code to the best practices using lint rules')
  .version(require(join(__dirname, 'package.json')).version);

program
  .command('output')
  .description('Generates a dashboard webpage to help track which files have file-based ignore directives in them')
  .requiredOption('-o, --output <path>', 'Output path for dashboard webpage')
  .option('--rootUrl <path|url>', 'Required if the dashboard is not hosted on your servers rootUrl')
  .option('--previous-results <path|url>', 'This should be a path or URL to the previous data.json file that was generated when this command was last run')
  .action(async ({output: outputPath, rootUrl, previousResults}) => {
    let lttfPlugins = await getLttfPlugins();
    output(lttfPlugins, outputPath, rootUrl, previousResults);
  })

program
  .command('list')
  .description('prints the current files with file-based lint ignore directives')
  .option('-o, --output <path>', 'output path for lttf list')
  .option('--stdout', 'print lttf list to console')
  .option('--previous-results <path|url>', 'This should be a path or URL to the previous data.json file that was generated when this command was last run')
  .action(async ({ output: outputPath, stdout, previousResults }) => {
    if (!outputPath && !stdout) {
      console.error('You must provide an output path to `list` with -o or pass --stdout');
    }

    let lttfPlugins = await getLttfPlugins();
    const listResult = await list(lttfPlugins, previousResults);

    if (stdout) {
      console.log(inspect(listResult, { depth: 5 }));
    }

    if (outputPath) {
      writeFileSync(outputPath, JSON.stringify(listResult));
    }
  });

program
  .command('ignore')
  .description('Add file-based ignores to any file that is currently erroring')
  .action(async () => {
    let lttfPlugins = await getLttfPlugins();
    for (let plugin of lttfPlugins) {
      await plugin.import.ignoreAll();
    }
  });

program.parse();
