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
const rimraf = require('rimraf');

const pluralize = require('pluralize');
const changeCase = require('change-case');

// convert handlebars-like helpers into mustache fn-blocks
const reTransformHelper = /\{\{\s*(\w+)\s+([.\w]+)\s*\}\}/g;

const MULTIPLE_CHOICES = [
  {
    key: 'y',
    name: 'Replace',
    value: 'replace',
  }, {
    key: 'n',
    name: 'Do not replace',
    value: 'skip',
  }, {
    key: 'a',
    name: 'Replace this and all others',
    value: 'replaceAll',
  }, {
    key: 's',
    name: 'Skip this and all others',
    value: 'skipAll',
  }, {
    key: 'x',
    name: 'Abort',
    value: 'abort',
  },
];

const SINGLE_CHOICES = [
  {
    key: 'y',
    name: 'Replace',
    value: 'replace',
  }, {
    key: 'n',
    name: 'Do not replace',
    value: 'skip',
  }, {
    key: 'x',
    name: 'Abort',
    value: 'abort',
  },
];

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
.split(/\s+/).forEach(fn => {
  HELPERS[fn] = () => (text, render) => changeCase[fn](render(`{{${text}}}`));
});

const SHORTHANDS = {
  add: 'dest',
  copy: 'dest',
  clean: 'dest',
  render: 'dest',
  modify: 'dest',
  exec: 'command',
  clone: 'gitUrl',
  extend: 'dest',
  install: 'dependencies',
};

const DEPS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const _slice = Array.prototype.slice;

const CLR = '\x1b[K';

function echo() {
  process.stdout.write(_slice.call(arguments).join('')
    .replace(/\r\r/g, `${CLR}\r`)
    .replace(/\r\n/g, `${CLR}\n`));
}

function _wrap(obj, cb) {
  Object.keys(obj).forEach(prop => {
    /* istanbul ignore else */
    if (prop !== 'close' && typeof obj[prop] === 'function') {
      const fn = obj[prop];

      obj[prop] = function wrapper() {
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

  args.forEach(data => {
    Object.keys(data).forEach(key => {
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
  _wrap(prompter, err => {
    ui.close();
    cb(err);
  });

  prompter.ask(value => {
    ui.close();
    cb(undefined, value);
  });
}

function _exec(io, cmd, quietly, currentPath) {
  return new Promise((resolve, reject) => {
    const env = {};

    // TODO: enhance this
    env.PATH = process.env.PATH;

    const ps = Array.isArray(cmd)
      ? cp.spawn(cmd[0], cmd.slice(1), { env, cwd: currentPath })
      : cp.exec(cmd, { env, cwd: currentPath });

    let stderr = '';
    let stdout = '';

    /* istanbul ignore else */
    if (!quietly) {
      ps.stdout.pipe(io.stdout || process.stdout);
    }

    ps.stdout.on('data', data => {
      stdout += data;
    });

    ps.stderr.on('data', data => {
      stderr += data;
    });

    ps.on('close', code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr));
      }
    });
  });
}

function _askIf(io, err, label, options) {
  return new Promise((resolve, reject) => {
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

function _install($, task, logger, destPath) {
  const result = { type: 'install' };

  const tasks = [];

  DEPS.forEach(key => {
    const args = [];

    // reduce nested deps
    (task[key] || []).slice().forEach(dep => {
      if (Array.isArray(dep)) {
        Array.prototype.push.apply(args, dep.filter(x => x));
      } else if (dep) {
        args.push(dep);
      }
    });

    /* istanbul ignore else */
    if (key !== 'dependencies' && !args.length) {
      return;
    }

    tasks.push(() => {
      /* istanbul ignore else */
      if (args.length && $.options.npm !== true) {
        args.unshift('add');
      }

      /* istanbul ignore else */
      if ($.options.npm === true) {
        args.unshift('install');
      }

      args.unshift($.options.npm === true ? 'npm' : 'yarn');

      /* istanbul ignore else */
      if (args.length > 2) {
        if (key === 'devDependencies') {
          args.push(`--${$.options.npm === true ? 'save-dev' : 'dev'}`);
        } else if (key === 'optionalDependencies') {
          args.push(`--${$.options.npm === true ? 'save-optional' : 'optional'}`);
        } else if ($.options.npm === true) {
          args.push('--save');
        }
      }

      logger(`${chalk.gray(`$ ${args.join(' ')}`)}\r\n`);

      if ($.options.npm === true) {
        args.push('--only=production');
      } else {
        args.push('--production');
      }

      args.push('--no-progress');
      args.push('--silent');

      return _exec($.io, args, false, destPath)
        .then(() => {
          /* istanbul ignore else */
          if (task[key]) {
            result[key] = task[key];
          }
        });
    });
  });

  return tasks
    .reduce((prev, cur) => prev.then(() => cur())
    , Promise.resolve()).then(() => result);
}

function _runTask($, task, logger) {
  const _values = {};

  const _changes = [];
  const _failures = [];

  // normalize input
  const options = $.options || {};
  const defaults = $.defaults || {};

  // merge initial values
  Object.keys(defaults).forEach(key => {
    /* istanbul ignore else */
    if (typeof task.validate === 'object' && typeof task.validate[key] === 'function') {
      const test = task.validate[key](defaults[key]);

      /* istanbul ignore else */
      if (test !== true) {
        throw new Error(test || `Invalid input for '${key}'`);
      }
    }

    _values[key] = defaults[key];
  });

  /* istanbul ignore else */
  if (typeof task === 'function') {
    task = task(_values, this) || {};
  }

  /* istanbul ignore else */
  if (task.arguments) {
    /* istanbul ignore else */
    if (!$.options.data) {
      throw new Error('Missing data for arguments');
    }

    task.arguments.forEach(key => {
      _values[key] = $.options.data.shift();
    });
  }

  // normalize task actions and params
  let _actions = task.actions || [];
  let _prompts = task.prompts || [];

  /* istanbul ignore else */
  if (typeof _prompts === 'function') {
    _prompts = _prompts(_values, this) || [];
  }

  /* istanbul ignore else */
  if (typeof _prompts.then === 'function') {
    return _prompts;
  }

  /* istanbul ignore else */
  if (task.quiet || options.quiet) {
    logger = () => {
      // noop
    };
  }

  return _prompts.reduce((prev, p) => {
    /* istanbul ignore else */
    if (!p) {
      return null;
    }

    /* istanbul ignore else */
    if (typeof p === 'function') {
      return Promise.resolve(p.call(this, _values, options));
    }

    return prev.then(() => new Promise((resolve, reject) => {
      /* istanbul ignore else */
      if (_values[p.name] && _values[p.name].length) {
        resolve();
        return;
      }

      /* istanbul ignore else */
      if (typeof task.validate === 'object' && typeof task.validate[p.name] === 'function') {
        p.validate = task.validate[p.name];
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
    }));
  }, Promise.resolve())
  .then(() => {
    /* istanbul ignore else */
    if (typeof _actions === 'function') {
      _actions = _actions.call(this, _values, options) || [];
    }

    /* istanbul ignore else */
    if (typeof _actions.then === 'function') {
      return _actions;
    }

    logger(`${chalk.gray(`↺ Loading ${_actions.length} task${_actions.length === 1 ? '' : 's'}...`)}\r\r`);

    return _actions.reduce((prev, a) => {
      /* istanbul ignore else */
      if (!a) {
        return prev;
      }

      let _tpl;
      let _src;
      let _dest;

      Object.keys(SHORTHANDS).forEach(key => {
        /* istanbul ignore else */
        if (a[key]) {
          a.type = key;
          a[SHORTHANDS[key]] = a[key];
        }
      });

      const _srcPath = () => {
        /* istanbul ignore else */
        if (!(a.src && typeof a.src === 'string')) {
          throw new Error(`Invalid src, given '${a.src}'`);
        }

        /* istanbul ignore else */
        if (!fs.existsSync(path.join(task.basePath || '', a.src))) {
          throw new Error(`Source '${a.src}' does not exists`);
        }

        return path.join(task.basePath || '', a.src);
      };

      const _destPath = () => {
        /* istanbul ignore else */
        if (!(a.dest && typeof a.dest === 'string')) {
          throw new Error(`Invalid dest, given '${a.dest}'`);
        }

        return path.join($.cwd, _render(a.dest, _values, HELPERS));
      };

      const _getTemplate = () => {
        /* istanbul ignore else */
        if (!(typeof a.template === 'undefined' && typeof a.templateFile === 'undefined')) {
          const tpl = a.templateFile
            ? fs.readdirSync(path.join(task.basePath || '', a.templateFile)).toString()
            : a.template;

          return _render(tpl, _values, HELPERS);
        }

        return a.content;
      };

      const _sourceFiles = () => {
        return fs.statSync(_src).isDirectory()
          ? glob.sync(`${_src}/**/*`, { dot: true, nodir: true })
          : [_src];
      };

      const _repository = () => {
        const _url = a.gitUrl ? _render(a.gitUrl || '', _values, HELPERS) : '';

        /* istanbul ignore else */
        if (!(_url && _url.indexOf('/') > 0)) {
          throw new Error(`Invalid gitUrl, given '${_url}'`);
        }

        return _url;
      };

      return prev.then(() => {
        /* istanbul ignore else */
        if (typeof a === 'function') {
          return Promise.resolve(a.call(this, _values, options));
        }

        switch (a.type) {
          case 'copy': {
            _src = _srcPath();

            let _skipAll = false;
            let _replaceAll = false;

            return options.copy !== false && _sourceFiles().reduce((_prev, cur) =>
              _prev.then(() => {
                _dest = path.join($.cwd, _render(a.dest || '', _values, HELPERS), path.relative(_src, cur));

                return _askIf($.io,
                  _skipAll || _replaceAll ? false : fs.existsSync(_dest) && options.force !== true,
                  `Replace '${path.relative($.cwd, _dest)}'`,
                  MULTIPLE_CHOICES)
                .then(result => {
                  /* istanbul ignore else */
                  if (result === 'abort') {
                    throw new Error(`File '${_src}' cannot be copied!`);
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
                    fs.copySync(cur, _dest);
                  }

                  logger(`  ${chalk.green(_skipAll || result === 'skip' ? 'skip' : 'save')}  ${path.relative($.cwd, _dest)}\r\n`);
                });
              }), Promise.resolve());
          }

          case 'modify': {
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

            _changes.push({
              type: a.type,
              dest: path.relative($.cwd, _dest),
            });

            const content = fs.readFileSync(_dest).toString();

            /* istanbul ignore else */
            if (a.unless
              && (typeof a.unless === 'string' || a.unless instanceof RegExp)
              && (typeof a.unless === 'string' ? content.indexOf(a.unless) > -1 : a.unless.test(content))) {
              logger(`  ${chalk.green('skip')}  ${path.relative($.cwd, _dest)}\r\n`);
              return;
            }

            const regexp = a.pattern instanceof RegExp ? a.pattern : new RegExp(a.pattern);
            const output = content.replace(regexp, _tpl);

            fs.outputFileSync(_dest, output);

            logger(`  ${chalk.green('change')}  ${path.relative($.cwd, _dest)}\r\n`);

            return;
          }

          case 'extend': {
            /* istanbul ignore else */
            if (typeof a.callback !== 'function') {
              throw new Error(`Invalid callback, given '${a.callback}'`);
            }

            _dest = _destPath();

            const data = require(_dest);

            _changes.push({
              type: a.type,
              dest: path.relative($.cwd, _dest),
            });

            a.callback(data, _values);
            fs.outputJSONSync(_dest, data);

            logger(`  ${chalk.green('change')}  ${path.relative($.cwd, _dest)}\r\n`);

            return;
          }

          case 'clone':
            downloadRepo = downloadRepo || require('download-github-repo');

            _src = _repository();
            _dest = _destPath();

            return options.clone !== false && _askIf($.io, (fs.existsSync(_dest)
              ? fs.readdirSync(_dest).length !== 0 : false) && options.force !== true,
              `Overwrite '${path.relative($.cwd, _dest) || '.'}' with '${_src}'`,
              SINGLE_CHOICES)
            .then(result => new Promise((resolve, reject) => {
              /* istanbul ignore else */
              if (result === 'abort') {
                throw new Error(`Repository '${_src}' cannot be cloned!`);
              }

              /* istanbul ignore else */
              if (result === 'skip') {
                logger(`  ${chalk.green('skip')}  ${path.relative($.cwd, _dest) || '.'} (${_src})\n`);
                resolve();
                return;
              }

              logger(`${chalk.gray(`↺ Downloading ${_src} from GitHub...`)}\r\r`);

              downloadRepo(_src, _dest, err => {
                if (err) {
                  reject(new Error(`Repository not found https://github.com/${_src}`));
                } else {
                  logger(`  ${chalk.green('clone')}  ${path.relative($.cwd, _dest) || '.'} (${_src})\r\n`);

                  _changes.push({
                    type: a.type,
                    repository: _src,
                  });

                  resolve();
                }
              });
            }));

          case 'add':
            _tpl = _getTemplate() || '';
            _dest = _destPath();

            return options.add !== false && _askIf($.io, fs.existsSync(_dest) && options.force !== true,
              `Replace '${path.relative($.cwd, _dest)}'`,
              SINGLE_CHOICES)
            .then(result => {
              /* istanbul ignore else */
              if (!result || result.replace) {
                _changes.push({
                  type: a.type,
                  dest: path.relative($.cwd, _dest),
                });

                fs.outputFileSync(_dest, _tpl);
              }

              logger(`  ${chalk.green(result === 'skip' ? 'skip' : 'save')}  ${path.relative($.cwd, _dest)}\r\n`);
            });

          case 'exec':
            /* istanbul ignore else */
            if (!(a.command && (typeof a.command === 'string'))) {
              throw new Error(`Invalid command, given '${a.command}'`);
            }

            a.command = _render(a.command || '', _values, HELPERS);

            return options.exec !== false && _exec($.io, a.command, options.quiet || a.quiet)
              .then(result => {
                _changes.push({
                  type: a.type,
                  stdOut: result,
                });
              });

          case 'clean':
            rimraf.sync(_destPath());
            return;

          // FIXME: validate dest-input for render/install

          case 'render':
            return (Array.isArray(a.dest) ? a.dest : [a.dest]).forEach(dest => {
              _dest = path.join($.cwd, dest);
              _tpl = _render(fs.readFileSync(_dest).toString(), _values, HELPERS);

              fs.outputFileSync(_dest, _tpl);
            });

          case 'install':
            return options.install !== false && _install($, a, logger, path.join($.cwd, _render(a.dest || '', _values, HELPERS)))
              .then(result => {
                _changes.push(result);
              });

          default:
            throw new Error(`Unsupported '${a.type}' action`);
        }
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

module.exports = function Haki(cwd, options) {
  options = options || {};

  /* istanbul ignore else */
  if (typeof cwd === 'object') {
    options = _merge(options, cwd);
    cwd = options.cwd;
  }

  const _helpers = {};
  const _tasks = {};

  // default logger is stdout
  const _logger = options.logger || echo;

  // normalize defaults
  cwd = cwd || options.cwd || process.cwd();

  delete options.cwd;

  // normalize io
  const _config = {
    input: options.stdin,
    output: options.stdout,
  };

  return {
    log(str) {
      /* istanbul ignore else */
      if (!options.quiet) {
        _logger(str);
      }
    },

    get(opt) {
      return options[opt];
    },

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
        return Promise.resolve().then(() =>
          _runTask.call(this, { cwd, io: _config, options, defaults }, name, options.logger || _logger));
      }

      return this.getGenerator(name).run(defaults);
    },

    hasGenerator(name) {
      return typeof _tasks[name] !== 'undefined';
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
    },
  };
};
