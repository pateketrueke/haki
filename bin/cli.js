/* eslint-disable global-require */

const argv = process.argv.slice(2);

// partial impl from `rc`
const win = process.platform === 'win32';
const cwd = process.cwd();
const etc = '/etc';

const home = win
  ? process.env.USERPROFILE
  : process.env.HOME;

let _task = 'default';

/* istanbul ignore else */
if (/^(?!-)[\w:-]+$/.test(argv[0])) {
  _task = argv.shift() || _task;
}

let $;

try {
  $ = require('wargs')(argv, {
    camelCase: true,
    boolean: 'ODIGRCAVvdqfhb',
    alias: {
      O: 'no-install-opts',
      D: 'no-install-dev',
      I: 'no-install',
      G: 'no-clone',
      R: 'no-exec',
      C: 'no-copy',
      A: 'no-add',
      V: 'verbose',
      v: 'version',
      d: 'debug',
      q: 'quiet',
      f: 'force',
      e: 'entry',
      g: 'gist',
      h: 'help',
      b: 'bare',
    },
  });
} catch (e) {
  process.stderr.write(`\r\x1b[31m${e.message}\x1b[0m\n`);
  process.exit(1);
}

const cleanStack = require('clean-stack');
const path = require('path');
const fs = require('fs');

// nice logs!
const log = require('log-pose')
  .getLogger(12, process.stdout, process.stderr);

const Haki = require('../lib');
const util = require('../lib/utils');
const thisPkg = require('../package.json');

const CONFIG = {};
const CACHE = [];

const _gists = path.join(home, '.config', thisPkg.name, 'gists');

/* istanbul ignore else */
if (!fs.existsSync(path.dirname(_gists))) {
  fs.mkdirSync(path.dirname(_gists));
}

/* istanbul ignore else */
if (!fs.existsSync(_gists)) {
  fs.mkdirSync(_gists);
}

let depth = 20;
let pwd = cwd;
let tmp;

const haki = new Haki(util.extend({}, $.flags, { data: $._ }));

if ($.flags.entry) {
  haki.load(path.resolve($.flags.entry));
}

function showError(e) {
  log.printf('{% fail %s %}\r\n', ($.flags.debug && cleanStack(e.stack)) || e.message);
}

function showHelp(tasks) {
  log.write('\r\n  Usage:\n    haki COMMAND [...]\n');

  /* istanbul ignore else */
  if (tasks.length) {
    tasks.forEach(params => {
      log.write(`    haki ${util.padding(params.gen, 20)}${
        params.value.description ? ['  # ', params.value.description].join('') : ''
      }\n`);
    });
  }

  log.write(`
  Options:
    -g, ${util.padding('[--gist]', 15)} # Manage and download gists (e.g. -g 8c918388a28612778668aa66b5a8f406)
    -f, ${util.padding('[--force]', 15)} # Overwrite files that already exist
    -f, ${util.padding('[--verbose]', 15)} # Display more information on logs
    -v, ${util.padding('[--version]', 15)} # Print version and quit
    -d, ${util.padding('[--debug]', 15)} # Print stack on error
    -q, ${util.padding('[--quiet]', 15)} # Supress status output
    -h, ${util.padding('[--help]', 15)} # Show this help message

`);

  /* istanbul ignore else */
  if ($.flags.verbose) {
    log.write('  Hakifiles:\n');

    CACHE.forEach(file => {
      log.write(`    ${file}\n`);
    });

    log.write('\n');
  }
}

function gists(id) {
  /* istanbul ignore else */
  if (!tmp) {
    tmp = {};
    fs.readdirSync(_gists)
      .filter(src => src.indexOf('.json') > -1)
      .forEach(src => {
        tmp[path.basename(src, '.json')] = require(path.join(_gists, src));
      });
  }

  /* istanbul ignore else */
  if (id) {
    return tmp[id];
  }

  return tmp;
}

function detail(data) {
  log.printf('{% link %s %}\r\n', data.html_url);
  log.printf('  {% gray %s <%s> %}\r\n', data.updated_at, data.owner.login);
  log.printf('  {% gray %s %}\r\n', data.description);
}

function setup(id, data) {
  return Promise.resolve()
    .then(() => {
      /* istanbul ignore else */
      if (data.message) {
        log.printf('\r\r{% warn %s %}\n', data.message);
        log.printf('{% link %s %}\n', data.documentation_url);
        util.die(1);
      }

      /* istanbul ignore else */
      if (!(data.files && data.files['Hakifile.js'])) {
        throw new Error(`Gist ${data.html_url} does not contains a Hakifile.js`);
      }

      const dir = path.join(_gists, id);

      /* istanbul ignore else */
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
      }

      Object.keys(data.files).forEach(src => {
        fs.writeFileSync(path.join(dir, src), data.files[src].content);
      });

      detail(data);
    });
}

function save(id, data) {
  try {
    return setup(id, data).then(() => {
      fs.writeFileSync(path.join(_gists, `${id}.json`), JSON.stringify(data));
      util.die();
    }).catch(e => {
      showError(e);
      util.die(1);
    });
  } catch (e) {
    showError(e);
    util.die(1);
  }
}

function load(filepath) {
  /* istanbul ignore else */
  if (CACHE.indexOf(filepath) > -1) {
    return;
  }

  try {
    /* istanbul ignore else */
    if (fs.existsSync(filepath)) {
      if (fs.statSync(filepath).isDirectory()) {
        const Hakifile = fs.readdirSync(filepath)
          .filter(file => file.indexOf('Hakifile') > -1);

        /* istanbul ignore else */
        if (Hakifile.length) {
          require(path.join(filepath, Hakifile[0]))(haki);
          CACHE.push(filepath);
        }
      } else {
        util.extend(CONFIG, JSON.parse(fs.readFileSync(filepath).toString()));
      }
    }
  } catch (e) {
    log.printf('{% fail Error in %s: %s %}\r\n', filepath, ($.flags.debug && cleanStack(e.stack)) || e.message);
    util.die(1);
  }
}

function list() {
  log.printf('{% info Listing gists from %s %}\n', _gists);

  const src = gists();
  const keys = Object.keys(src).length;

  Object.keys(src).forEach(key => {
    detail(src[key]);
  });

  log.printf('{% log %s gist%s found %}\n', keys, keys === 1 ? '' : 's');
}

function get(id) {
  try {
    log(false, `Fetching Gist ${id} ...`, () => {
      /* istanbul ignore else */
      if (gists(id) && $.flags.force !== true) {
        showError(new Error(`Gist ${id} already installed`));
        util.die(1);
      }

      return new Promise((resolve, reject) => {
        let data = '';

        require('https').get({
          path: `/gists/${id}`,
          host: 'api.github.com',
          headers: {
            'User-Agent': `NodeJS/Haki v${thisPkg.version}`,
          },
        }, res => {
          res.on('data', chunk => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              save(id, JSON.parse(data))
                .then(resolve)
                .catch(reject);
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', e => {
          reject(e);
        });
      }).catch(e => {
        showError(e);
        util.die(1);
      });
    });
  } catch (e) {
    showError(e);
    util.die(1);
  }
}

function run() {
  if (!$.flags.bare) {
    log.printf('{% wait Finding Hakifile(s) ... %}\r\r');

    // built-in generators
    require('./Hakifile')(haki);

    load(path.join(etc, '.config', thisPkg.name));
    load(path.join(etc, `.${thisPkg.name}rc`));

    load(path.join(home, '.config', thisPkg.name));
    load(path.join(home, `.${thisPkg.name}rc`));

    while (depth > 0) {
      load(path.join(pwd, '.config', thisPkg.name));
      load(path.join(pwd, `.${thisPkg.name}rc`));
      load(pwd);

      pwd = path.dirname(pwd);

      depth -= 1;

      /* istanbul ignore else */
      if (pwd === '/' || pwd === home) {
        break;
      }
    }

    // installed gists
    Object.keys(gists()).forEach(id => {
      load(path.join(_gists, id));
    });

    log.printf('{% log %s Hakifile%s found %}\r\n', CACHE.length, CACHE.length === 1 ? '' : 's');
  }

  /* istanbul ignore else */
  if ($.flags.help) {
    showHelp(haki.getGeneratorList());
    util.die();
  }

  if (haki.hasGenerator(_task)) {
    haki.runGenerator(_task, util.extend({}, $.data, $.params, CONFIG))
      .catch(e => {
        log.printf('{% fail %s %}\r\n', ($.flags.debug && cleanStack(e.stack)) || e.message);
        util.die(1);
      })
      .then(() => Haki.closeAll());
  } else {
    log.printf('{% fail Missing `%s` generator %}\r\n', _task);
    util.die(1);
  }
}

/* istanbul ignore else */
if ($.flags.version) {
  log.printf('{% green %s v%s %} {% gray (node %s) %}\n',
    thisPkg.name, thisPkg.version, process.version);
  util.die();
}

if (!$.flags.bare) {
  log.printf('{% green Haki v%s %} {% gray (%s in %s) %}\n', thisPkg.version, _task, process.env.NODE_ENV || '?');
}

process.on('exit', statusCode => {
  /* istanbul ignore else */
  if (!statusCode && !$.flags.bare) {
    log.printf('\r\r{% end Done. %}\r\n');
  }
  Haki.closeAll();
  util.die();
});

/* istanbul ignore else */
if ($.flags.gist) {
  /* istanbul ignore else */
  if ($.flags.gist !== true) {
    get($.flags.gist);
  } else {
    list();
  }
} else {
  run();
}
