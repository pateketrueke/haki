'use strict';

/* eslint-disable global-require */
/* eslint-disable prefer-rest-params */

let Mustache;
let ReadlineUI;
let downloadRepo;

const cp = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const chalk = require('chalk');

const pluralize = require('pluralize');
const changeCase = require('change-case');

// convert handlebars-like helpers into mustache fn-blocks
const reTransformHelper = /\{\{\s*(\w+)\s+([.\w]+)\s*\}\}/g;

const MULTIPLE_CHOICES = [
  {
    key: 'y',
    name: 'Replace',
    value: 'replace'
  }, {
    key: 'n',
    name: 'Do not replace',
    value: 'skip'
  }, {
    key: 'a',
    name: 'Replace this and all others',
    value: 'replaceAll'
  }, {
    key: 's',
    name: 'Skip this and all others',
    value: 'skipAll'
  }, {
    key: 'x',
    name: 'Abort',
    value: 'abort'
  },
];

const SINGLE_CHOICES = [
  {
    key: 'y',
    name: 'Replace',
    value: 'replace'
  }, {
    key: 'n',
    name: 'Do not replace',
    value: 'skip'
  }, {
    key: 'x',
    name: 'Abort',
    value: 'abort'
  },
];

const ASK_CHOICES = [
  {
    key: 'y',
    name: 'Continue',
    value: 'continue'
  }, {
    key: 'n',
    name: 'Do not continue',
    value: 'skip'
  }, {
    key: 'x',
    name: 'Abort',
    value: 'abort'
  },
];

const EXTENSIONS = {
  js: process.env.NVM_BIN ? `${process.env.NVM_BIN}/node` : 'node',
  sh: 'sh',
  py: 'python',
  rb: 'ruby',
  pl: 'perl',
  lua: 'lua',
  php: 'php',
};

const PROMPTS = {
  input: 'enquirer-prompt-input',
  checkbox: 'prompt-checkbox',
  confirm: 'prompt-confirm',
  expand: 'prompt-expand',
  list: 'prompt-list',
  password: 'prompt-password',
  radio: 'prompt-radio',
  rawlist: 'prompt-rawlist',
};

const HELPERS = {
  singularize: () => (text, render) => pluralize.singular(render(`{{${text}}}`)),
  pluralize: () => (text, render) => pluralize.plural(render(`{{${text}}}`)),
};

// apply common helpers
`dotCase swapCase pathCase upperCase lowerCase camelCase snakeCase titleCase
paramCase headerCase pascalCase constantCase sentenceCase ucFirst lcFirst`
.split(/\s+/).map((fn) => {
  HELPERS[fn] = () => (text, render) => changeCase[fn](render(`{{${text}}}`));
});

const CLR = '\x1b[K';

const _slice = Array.prototype.slice;

function _pre(value) {
  return `${chalk.green(value)}${new Array(7 - value.length).join(' ')}`;
}

function _wrap(obj, cb) {
  Object.keys(obj).forEach((prop) => {
    /* istanbul ignore else */
    if (prop !== 'close' && typeof obj[prop] === 'function') {
      const fn = obj[prop];

      obj[prop] = function() {
        try {
          return fn.apply(obj, arguments);
        } catch (e) {
          cb(e);
        }
      };
    }
  });
}

function _merge(obj) {
  const args = _slice.call(arguments, 1);

  args.forEach((data) => {
    Object.keys(data).forEach((key) => {
      obj[key] = data[key];
    });
  });

  return obj;
}

function _render(str) {
  const args = _slice.call(arguments, 1);
  const obj = args.reduce((prev, x) => _merge(prev, x), {});

  Mustache = Mustache || require('mustache');

  return Mustache.render(str.replace(reTransformHelper, '{{#$1}}$2{{/$1}}'), obj);
}

function _prompt(opts, cb) {
  const _type = opts.type || 'input';

  try {
    /* istanbul ignore else */
    if (typeof PROMPTS[_type] !== 'function') {
      PROMPTS[_type] = require(PROMPTS[_type]);
    }
  } catch (e) {
    cb(new Error(`Unsupported '${_type}' prompt`));
    return;
  }

  ReadlineUI = ReadlineUI || require('readline-ui');

  // let output as ttys
  const ui = new ReadlineUI(this);

  const Type = PROMPTS[_type];
  const params = _merge({}, opts);
  const prompter = new Type(params, null, ui);

  // decorate critical methods
  _wrap(prompter, (err) => {
    ui.close();
    cb(err);
  });

  prompter.ask((value) => {
    ui.close();
    cb(undefined, value);
  });
}

function _exec(io, task) {
  const ext = path.extname(task.command).substr(1);
  const cmd = EXTENSIONS[ext];
  const env = {};

  /* istanbul ignore else */
  if (!cmd) {
    throw new Error(`Extension '.${ext}' is not supported, yet`);
  }

  return new Promise((resolve, reject) => {
    const command = `${cmd} ${task.command}`;

    const ps = cp.exec(command, { env });

    let stderr = '';

    ps.stdout.pipe(io.stdout || process.stdout);
    ps.stderr.pipe(io.stderr || process.stderr);
    ps.stderr.on('data', (data) => {
      stderr += data;
    });

    ps.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr));
      }
    });
  });
}

function _askIf(io, err, label, options, abortOnFail) {
  return new Promise((resolve, reject) => {
    /* istanbul ignore else */
    if (abortOnFail) {
      reject(err || new Error(label));
      return;
    }

    /* istanbul ignore else */
    if (!err) {
      resolve();
      return;
    }

    _prompt.call(io, {
      name: 'action',
      type: 'expand',
      message: label,
      choices: options,
    }, (_err, value) => {
      if (_err) {
        reject(_err);
      } else {
        resolve(value);
      }
    });
  });
}

function _runTask($, task, logger) {
  const _values = {};

  const _changes = [];
  const _failures = [];

  // normalize input
  const options = $.options || {};
  const defaults = $.defaults || {};

  // merge initial values
  Object.keys(defaults).forEach((key) => {
    _values[key] = defaults[key];
  });

  /* istanbul ignore else */
  if (typeof task === 'function') {
    task = task(_values, this) || {};
  }

  /* istanbul ignore else */
  if (task.arguments) {
    task.arguments.forEach(key => {
      _values[key] = $.options.data.shift();
    });
  }

  // normalize task actions and params
  let _actions = task.actions || [];
  let _prompts = task.prompts || [];

  /* istanbul ignore else */
  if (typeof _prompts === 'function') {
    _prompts = _prompts(_values, this) || {};
  }

  /* istanbul ignore else */
  if (options.quiet) {
    logger = () => {
      // noop
    };
  }

  return _prompts.reduce((prev, p) =>
    prev.then(() => new Promise((resolve, reject) => {
      /* istanbul ignore else */
      if (_values[p.name] && _values[p.name].length) {
        resolve();
        return;
      }

      _prompt.call($.io, p, (err, value) => {
        /* istanbul ignore else */
        if (err) {
          reject(err);
          return;
        }

        _values[p.name] = value;

        resolve();
      });
    }))
  , Promise.resolve())
  .then(() => {
    /* istanbul ignore else */
    if (typeof _actions === 'function') {
      _actions = _actions.call(this, _values, options) || [];
    }

    /* istanbul ignore else */
    if (typeof _actions.then === 'function') {
      return _actions;
    }

    logger(`↺ Loading ${_actions.length} task${_actions.length === 1 ? '' : 's'}...${CLR}\r`);

    return _actions.reduce((prev, a) => {
      let _tpl;
      let _src;
      let _dest;

      const _srcPath = () => {
        /* istanbul ignore else */
        if (!(a.srcPath && typeof a.srcPath === 'string')) {
          throw new Error(`Invalid srcPath, given '${a.srcPath}'`);
        }

        /* istanbul ignore else */
        if (!fs.existsSync(path.join(task.basePath || '', a.srcPath))) {
          throw new Error(`Source '${a.srcPath}' does not exists`);
        }

        return path.join(task.basePath || '', a.srcPath);
      };

      const _destPath = () => {
        /* istanbul ignore else */
        if (!(a.destPath && typeof a.destPath === 'string')) {
          throw new Error(`Invalid destPath, given '${a.destPath}'`);
        }

        return path.join($.cwd, _render(a.destPath, _values, HELPERS));
      };

      const _getTemplate = () => {
        /* istanbul ignore else */
        if (!(typeof a.template === 'undefined' && typeof a.templateFile === 'undefined')) {
          const tpl = a.templateFile
            ? path.join(task.basePath || '', a.templateFile)
            : a.template;

          return _render(fs.existsSync(tpl) ? fs.readFileSync(tpl).toString() : tpl, _values, HELPERS);
        }
      };

      const _sourceFiles = () => {
        return fs.statSync(_src).isDirectory()
          ? glob.sync(`${_src}/**/*`, { dot: true, nodir: true })
          : [_src];
        };

      const _repository = () => {
        const _url = a.gitUrl ? _render(a.gitUrl || '', _values, HELPERS) : '';

        /* istanbul ignore else */
        if (!(_url && _url.indexOf('/') > 1)) {
          throw new Error(`Invalid gitUrl, given ${_url}`);
        }

        return _url;
      };

      return prev.then(() => {
        /* istanbul ignore else */
        if (typeof a === 'function') {
          return Promise.resolve(a.call(this, _values, options));
        }

        switch (a.type) {
          case 'copy':
            _src = _srcPath();

            let _skipAll = false;
            let _replaceAll = false;

            return _sourceFiles().reduce((_prev, cur) =>
              _prev.then(() => {
                _dest = path.join($.cwd, _render(a.destPath, _values, HELPERS), path.relative(_src, cur));

                return _askIf($.io,
                  _skipAll || _replaceAll ? false : fs.existsSync(_dest) && options.force !== true,
                  `Replace '${path.relative($.cwd, _dest)}'`,
                  MULTIPLE_CHOICES,
                  a.abortOnFail || task.abortOnFail
                ).then(result => {
                  /* istanbul ignore else */
                  if (result === 'abort') {
                    throw new Error('The task was aborted!');
                  }

                  /* istanbul ignore else */
                  if (result === 'replaceAll') {
                    _replaceAll = true;
                  }

                  /* istanbul ignore else */
                  if (result === 'skipAll') {
                    _skipAll = true;
                  }

                  /* istanbul ignore else */
                  if (!result || _replaceAll || result === 'replace') {
                    fs.outputFileSync(_dest, _render(fs.readFileSync(cur).toString(), _values, HELPERS));
                  }

                  logger(`  ${_pre(_skipAll || result === 'skip' ? 'skip' : a.type)}  ${path.relative($.cwd, _dest)}${CLR}\n`);
                });
              }), Promise.resolve());

          case 'modify':
            /* istanbul ignore else */
            if (!(a.pattern && (typeof a.pattern === 'string' || a.pattern instanceof RegExp))) {
              throw new Error(`Invalid pattern, given '${a.pattern}'`);
            }

            _tpl = _getTemplate() || '';
            _dest = _destPath();

            /* istanbul ignore else */
            if (!fs.existsSync(_dest)) {
              throw new Error(`Destination path '${_dest}' is missing`);
            }

            return _askIf($.io, options.force !== true,
              `Save changes to '${path.relative($.cwd, _dest)}'`,
              ASK_CHOICES,
              a.abortOnFail || task.abortOnFail
            ).then(result => {
              /* istanbul ignore else */
              if (!result || result === 'continue') {
                _changes.push({
                  type: a.type,
                  destPath: path.relative($.cwd, _dest),
                });

                fs.outputFileSync(_dest, fs.readFileSync(_dest).toString()
                  .replace(new RegExp(a.pattern), _render(_tpl, _values, HELPERS)));
              }

              logger(`  ${_pre(result === 'skip' ? 'skip ' : a.type)}  ${path.relative($.cwd, _dest)}${CLR}\n`);
            });

          case 'clone':
            downloadRepo = downloadRepo || require('download-github-repo');

            _src = _repository();
            _dest = _destPath();

            return _askIf($.io, (fs.existsSync(_dest) ? fs.readdirSync(_dest).length !== 0 : false) && options.force !== true,
              `Overwrite '${path.relative($.cwd, _dest)}'`,
              SINGLE_CHOICES,
              a.abortOnFail || task.abortOnFail
            ).then(result => new Promise((resolve, reject) => {
              /* istanbul ignore else */
              if (result === 'abort') {
                throw new Error('The task was aborted!');
              }

              /* istanbul ignore else */
              if (result === 'skip') {
                logger(`  ${_pre('skip')}  ${path.relative($.cwd, _dest)}`);
                resolve();
                return;
              }

              logger(`Downloading ${_src} from GitHub...${CLR}\r`);

              downloadRepo(_src, _dest, (err) => {
                if (err) {
                  reject(new Error(`Repository not found https://github.com/${_src}`));
                } else {
                  logger(`  ${_pre(a.type)}  ${path.relative($.cwd, _dest)}${CLR}\n`);
                  resolve();
                }
              });
            }));

          case 'add':
            _tpl = _getTemplate() || '';
            _dest = _destPath();

            return _askIf($.io, fs.existsSync(_dest) && options.force !== true,
              `Replace '${path.relative($.cwd, _dest)}'`,
              SINGLE_CHOICES,
              a.abortOnFail || task.abortOnFail
            ).then(result => {
              /* istanbul ignore else */
              if (!result || result.replace) {
                _changes.push({
                  type: a.type,
                  destPath: path.relative($.cwd, _dest),
                });

                fs.outputFileSync(_dest, _render(_tpl, _values, HELPERS));
              }

              logger(`  ${_pre(result === 'skip' ? 'skip' : a.type)}  ${path.relative($.cwd, _dest)}${CLR}\n`);
            });

          case 'exec':
            /* istanbul ignore else */
            if (!(a.command && (typeof a.command === 'string'))) {
              throw new Error(`Invalid command, given '${a.command}'`);
            }

            a.command = path.resolve(task.basePath || '', a.command);

            return _exec($.io, a);

          default:
            throw new Error(`Unsupported '${a.type}' action`);
        }

        return Promise.resolve();
      })
      .catch(err => {
        _failures.push(err);

        /* istanbul ignore else */
        if (a.abortOnFail || task.abortOnFail) {
          throw err;
        }

        logger(`${chalk.red((options.debug && err.stack) || err.message)}\n`);
      });
    }, Promise.resolve());
  })
  .then(() => ({ changes: _changes, failures: _failures }))
  .catch(error => {
    /* istanbul ignore else */
    if (task.abortOnFail) {
      throw error;
    }

    return { error, changes: _changes, failures: _failures };
  });
}

module.exports = function Haki(cwd, stdin, stdout) {
  let options = {};

  /* istanbul ignore else */
  if (typeof cwd === 'object') {
    options = _merge({}, cwd);
    cwd = options.cwd;
  }

  const _helpers = {};
  const _tasks = {};

  // default logger is stdout
  let _logger = process.stdout.write.bind(process.stdout);

  // normalize defaults
  cwd = cwd || options.cwd || process.cwd();

  delete options.cwd;

  // normalize io
  const _config = {
    input: options.stdin || stdin,
    output: options.stdout || stdout,
  };

  return {
    load(file) {
      /* istanbul ignore else */
      if (!(file && typeof file === 'string')) {
        throw new Error(`File must be a string, given '${file}'`);
      }

      try {
        file = require.resolve(file);
      } catch (e) {
        file = path.resolve(cwd, file);
      }

      require(file)(this);

      return this;
    },

    prompt(opts) {
      /* istanbul ignore else */
      if (!(opts && typeof opts === 'object' && typeof opts.name === 'string')) {
        throw new Error(`Prompt options are invalid, given '${opts}'`);
      }

      return new Promise((resolve, reject) => {
        _prompt.call(_config, opts, (err, value) => {
          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        });
      });
    },

    getPath(dest) {
      /* istanbul ignore else */
      if (dest && typeof dest !== 'string') {
        throw new Error(`Path must be a string, given '${dest}'`);
      }

      return path.join(cwd, dest || '');
    },

    addHelper(name, fn) {
      /* istanbul ignore else */
      if (!(name && typeof name === 'string')) {
        throw new Error(`Helper name must be a string, given '${name}'`);
      }

      /* istanbul ignore else */
      if (typeof fn !== 'function') {
        throw new Error(`Helper for '${name}' must be a function, given '${fn}'`);
      }

      _helpers[name] = fn;

      return this;
    },

    getHelperList() {
      return Object.keys(_helpers).concat(Object.keys(HELPERS));
    },

    renderString(value, data) {
      /* istanbul ignore else */
      if (!(value && typeof value === 'string')) {
        throw new Error(`Template must be a string, given '${value}'`);
      }

      return _render(value, data || {}, _helpers, HELPERS);
    },

    setGenerator(name, opts) {
      /* istanbul ignore else */
      if (!(name && typeof name === 'string')) {
        throw new Error(`Generator name must be a string, given '${name}'`);
      }

      _tasks[name] = opts || {};
      _tasks[name].run = defaults =>
        this.runGenerator(_tasks[name], defaults);

      return this;
    },

    getGenerator(name) {
      /* istanbul ignore else */
      if (!_tasks[name]) {
        throw new Error(`The '${name}' generator does not exists`);
      }

      return _tasks[name];
    },

    runGenerator(name, defaults) {
      /* istanbul ignore else */
      if (typeof name === 'object') {
        return _runTask.call(this, { cwd, io: _config, options, defaults }, name, options.logger || _logger);
      }

      return this.getGenerator(name).run(defaults);
    },

    getGeneratorList() {
      return Object.keys(_tasks).map(t => ({ name: t, task: _tasks[t] }));
    },

    chooseGeneratorList(defaults) {
      /* istanbul ignore else */
      if (!Object.keys(_tasks).length) {
        throw new Error('There are no registered generators');
      }

      return new Promise((resolve, reject) => {
        _prompt.call(_config, {
          name: 'task',
          type: 'list',
          message: 'Choose a generator:',
          choices: this.getGeneratorList(),
        }, (err, value) => {
          /* istanbul ignore else */
          if (err) {
            reject(err);
            return;
          }

          resolve(this.runGenerator(value, defaults));
        });
      });
    }
  };
};
