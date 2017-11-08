'use strict';

/* eslint-disable global-require */
/* eslint-disable prefer-rest-params */

let Mustache;
let ReadlineUI;
let downloadRepo;

// constants
const _ = require('./constants');

const cp = require('child_process');
const lp = require('log-pose');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const rimraf = require('rimraf');

// convert handlebars-like helpers into mustache fn-blocks
const reTransformHelper = /\{\{\s*(\w+)\s+([.\w]+)\s*\}\}/g;

const _readlines = [];

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
  const args = Array.prototype.slice.call(arguments, 1);

  args.forEach(data => {
    Object.keys(data).forEach(key => {
      obj[key] = data[key];
    });
  });

  return obj;
}

function _render(str) {
  const args = Array.prototype.slice.call(arguments, 1);
  const obj = args.reduce((prev, x) => _merge(prev, x), {});

  Mustache = Mustache || require('mustache');

  return Mustache.render(str.replace(reTransformHelper, '{{#$1}}$2{{/$1}}'), obj);
}

function _prompt(opts, cb) {
  const _type = opts.type || 'input';

  // pause earlier
  lp.pause();

  try {
    /* istanbul ignore else */
    if (typeof _.PROMPTS[_type] !== 'function') {
      _.PROMPTS[_type] = require(_.PROMPTS[_type]);
    }
  } catch (e) {
    cb(new Error(`Unsupported '${_type}' prompt`));
    return;
  }

  ReadlineUI = ReadlineUI || require('readline-ui');

  // let output as ttys
  const ui = new ReadlineUI(this);

  const Type = _.PROMPTS[_type];
  const params = _merge({}, opts);

  /* istanbul ignore else */
  if (opts.choices) {
    opts.choices = opts.choices.map(c => {
      c.name = c.label || c.name;
      c.result = c.value;
      delete c.value;
      delete c.label;
      return c;
    });
  }

  const prompter = new Type(params, null, ui);

  const _offset = _readlines.length;

  _readlines.push({ prompter, ui });

  // decorate critical methods
  _wrap(prompter, err => {
    _readlines[_offset] = null;
    lp.resume();
    prompter.close();
    ui.close();
    cb(err);
  });

  prompter.ask(value => {
    _readlines[_offset] = null;
    lp.resume();
    prompter.close();
    ui.close();

    /* istanbul ignore else */
    if (opts.choices) {
      const data = opts.choices
        .filter(c => (typeof c === 'object' ? c.name === value : false))[0];

      value = data && typeof data.result !== 'undefined' ? data.result : value;
    }

    cb(undefined, value);
  });
}

function _exec(io, cmd, currentPath) {
  return new Promise((resolve, reject) => {
    const env = {};

    // TODO: enhance this
    env.PATH = process.env.PATH;

    const ps = Array.isArray(cmd)
      ? cp.spawn(cmd[0], cmd.slice(1), { env, cwd: currentPath })
      : cp.exec(cmd, { env, cwd: currentPath });

    let stderr = '';
    let stdout = '';

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

function _install($, task, logger, quietly, destPath) {
  const result = { type: 'install' };

  const tasks = [];

  _.DEPS.forEach(key => {
    const args = [];

    /* istanbul ignore else */
    if (key === 'optionalDependencies' && $.options.installOpts === false) {
      return;
    }

    /* istanbul ignore else */
    if (key === 'devDependencies' && $.options.installDev === false) {
      return;
    }

    /* istanbul ignore else */
    if (key === 'dependencies' && $.options.install === false) {
      return;
    }

    /* istanbul ignore else */
    if (typeof task[key] === 'undefined') {
      return;
    }

    // reduce nested deps
    (task[key] || []).slice().forEach(dep => {
      if (Array.isArray(dep)) {
        Array.prototype.push.apply(args, dep.filter(x => x));
      } else if (dep) {
        args.push(dep);
      }
    });

    // backup
    const _deps = args.slice();

    tasks.push(() => {
      /* istanbul ignore else */
      if (args.length && $.options.yarn === true) {
        args.unshift('add');
      }

      /* istanbul ignore else */
      if ($.options.yarn !== true) {
        args.unshift('install');
      }

      args.unshift($.options.yarn !== true ? 'npm' : 'yarn');

      /* istanbul ignore else */
      if (args.length > 2) {
        if (key === 'devDependencies') {
          args.push(`--${$.options.yarn !== true ? 'save-dev' : 'dev'}`);
        } else if (key === 'optionalDependencies') {
          args.push(`--${$.options.yarn !== true ? 'save-optional' : 'optional'}`);
        } else if ($.options.yarn !== true) {
          args.push('--save');
        }
      }

      args.push('--silent');
      args.push('--no-progress');

      if (key !== 'optionalDependencies') {
        if ($.options.yarn !== true) {
          args.push('--no-optional');
        } else {
          args.push('--ignore-optional');
        }
      }

      return logger('install', _deps.join(' '), end =>
        _exec($.io, args, destPath)
          .then(data => {
            /* istanbul ignore else */
            if (task[key]) {
              result[key] = task[key];
            }

            if (!end) {
              logger.printf(`\r\r${data.replace(/\n+$/, '\n')}`);
            } else if (!quietly) {
              end(() => logger.printf(`\r\r${data.replace(/\n+$/, '\n')}`));
            } else {
              end();
            }
          }));
    });
  });

  return tasks
    .reduce((prev, cur) => prev.then(() => cur())
      , Promise.resolve()).then(() => result);
}

function _runTask($, task, logger, _helpers) {
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

  // main
  const run = () =>
    _prompts.reduce((prev, p) => {
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

        logger.printf('\r{% wait Loading %s task%s ... %}\r\r', _actions.length, _actions.length === 1 ? '' : 's');

        return _actions.reduce((prev, a) => {
        /* istanbul ignore else */
          if (!a) {
            return prev;
          }

          let _tpl;
          let _src;
          let _dest;

          Object.keys(_.SHORTHANDS).forEach(key => {
          /* istanbul ignore else */
            if (a[key]) {
              a.type = key;
              a[_.SHORTHANDS[key]] = a[key];
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

            return path.join($.cwd, _render(a.dest, _values, _helpers, _.HELPERS));
          };

          const _getTemplate = () => {
          /* istanbul ignore else */
            if (!(typeof a.template === 'undefined' && typeof a.templateFile === 'undefined')) {
              const tpl = a.templateFile
                ? fs.readdirSync(path.join(task.basePath || '', a.templateFile)).toString()
                : a.template;

              return _render(tpl, _values, _helpers, _.HELPERS);
            }

            return a.content;
          };

          const _sourceFiles = () => {
            return fs.statSync(_src).isDirectory()
              ? glob.sync(`${_src}/**/*`, { dot: true, nodir: true })
              : [_src];
          };

          const _repository = () => {
            const _url = a.gitUrl ? _render(a.gitUrl, _values, _helpers, _.HELPERS) : '';

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
                    _dest = path.join($.cwd, _render(a.dest || '', _values, _helpers, _.HELPERS), path.relative(_src, cur));

                    return logger('write', path.relative($.cwd, _dest), end =>
                      _askIf($.io,
                        _skipAll || _replaceAll ? false : fs.existsSync(_dest) && options.force !== true,
                        `Replace '${path.relative($.cwd, _dest)}'`,
                        _.MULTIPLE_CHOICES)
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

                          /* istanbul ignore else */
                          if (end) {
                            if (_skipAll || result === 'skip') {
                              end(path.relative($.cwd, _dest), 'skip', 'end');
                            } else {
                              end();
                            }
                          }
                        }));
                  }), Promise.resolve());
              }

              case 'modify':
                _dest = _destPath();

                return logger('change', path.relative($.cwd, _dest), end => {
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
                  /* istanbul ignore else */
                    if (end) {
                      end(path.relative($.cwd, _dest), 'skip', 'end');
                    }
                    return;
                  }

                  const regexp = a.pattern instanceof RegExp ? a.pattern : new RegExp(a.pattern);
                  const output = content.replace(regexp, _tpl);

                  fs.outputFileSync(_dest, output);

                  /* istanbul ignore else */
                  if (end) {
                    end();
                  }
                });

              case 'extend':
                _dest = _destPath();

                return logger('extend', path.relative($.cwd, _dest), () => {
                /* istanbul ignore else */
                  if (typeof a.callback !== 'function') {
                    throw new Error(`Invalid callback, given '${a.callback}'`);
                  }

                  const data = fs.existsSync(_dest)
                    ? fs.readJsonSync(_dest)
                    : {};

                  _changes.push({
                    type: a.type,
                    dest: path.relative($.cwd, _dest),
                  });

                  const _utils = _merge({}, _helpers, _.HELPERS);

                  Object.keys(_utils).forEach(k => {
                    if (typeof _values[k] === 'undefined') {
                      _values[k] = v => _utils[k]()(v, y => y.substr(3, y.length - 6));
                    }
                  });

                  a.callback(data, _values);
                  fs.outputJsonSync(_dest, data, {
                    spaces: 2,
                  });
                });

              case 'clone':
                downloadRepo = downloadRepo || require('download-github-repo');

                _src = _repository();
                _dest = _destPath();

                return options.clone !== false && logger('clone', _src, end => _askIf($.io, (fs.existsSync(_dest)
                  ? fs.readdirSync(_dest).length !== 0 : false) && options.force !== true,
                `Overwrite '${path.relative($.cwd, _dest) || '.'}' with '${_src}'`,
                _.SINGLE_CHOICES)
                  .then(result => new Promise((resolve, reject) => {
                    /* istanbul ignore else */
                    if (result === 'abort') {
                      reject(new Error(`Repository '${_src}' cannot be cloned!`));
                      return;
                    }

                    /* istanbul ignore else */
                    if (result === 'skip') {
                      resolve();
                      return;
                    }

                    downloadRepo(_src, _dest, err => {
                      if (err) {
                        reject(new Error(`Not found https://github.com/${_src}`));
                      } else {
                        _changes.push({
                          type: a.type,
                          repository: _src,
                        });
                        resolve();
                      }
                    });
                  }).then(() => end && end(`${path.relative($.cwd, _dest) || '.'} (${_src})`))));

              case 'add':
                _tpl = _getTemplate() || '';
                _dest = _destPath();

                return options.add !== false && logger('write', path.relative($.cwd, _dest), end =>
                  _askIf($.io, fs.existsSync(_dest) && options.force !== true,
                    `Replace '${path.relative($.cwd, _dest)}'`,
                    _.SINGLE_CHOICES)
                    .then(result => {
                      /* istanbul ignore else */
                      if (!result || result.replace) {
                        _changes.push({
                          type: a.type,
                          dest: path.relative($.cwd, _dest),
                        });

                        fs.outputFileSync(_dest, _tpl);
                      }

                      /* istanbul ignore else */
                      if (end && result === 'skip') {
                        return end(path.relative($.cwd, _dest), 'skip', 'end');
                      }

                      if (end) {
                        end();
                      }
                    }));

              case 'exec':
              /* istanbul ignore else */
                if (!(a.command && (typeof a.command === 'string'))) {
                  throw new Error(`Invalid command, given '${a.command}'`);
                }

                a.command = _render(a.command || '', _values, _helpers, _.HELPERS);

                return options.exec !== false && logger('exec', a.command, end =>
                  _exec($.io, a.command)
                    .then(result => {
                      _changes.push({
                        type: a.type,
                        stdOut: result,
                      });

                      if (!end) {
                        logger.printf(`\r\r${result.replace(/\n+$/, '\n')}`);
                      } else if (!(options.quiet || a.quiet)) {
                        end(() => logger.printf(`\r\r${result.replace(/\n+$/, '\n')}`));
                      } else {
                        end();
                      }
                    }));

              case 'clean':
                rimraf.sync(_destPath());
                return;

                // FIXME: validate dest-input for render/install

              case 'render':
                return (Array.isArray(a.dest) ? a.dest : [a.dest]).forEach(dest => {
                  _dest = path.join($.cwd, _render(dest, _values, _helpers, _.HELPERS));
                  _tpl = _render(fs.readFileSync(_dest).toString(), _values, _helpers, _.HELPERS);

                  fs.outputFileSync(_dest, _tpl);
                });

              case 'install':
                return _install($, a, logger, a.quiet || options.quiet,
                  path.join($.cwd, _render(a.dest || '', _values, _helpers, _.HELPERS)))
                  .then(result => {
                    _changes.push(result);
                  });

              default:
                throw new Error(`Unsupported '${a.type || JSON.stringify(a)}' action`);
            }
          })
            .catch(err => {
              _failures.push(err);

              /* istanbul ignore else */
              if (a.abortOnFail || task.abortOnFail) {
                throw err;
              }

              logger.printf('\r%s\r\n', (options.debug && err.stack) || err.message);
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

  /* istanbul ignore else */
  if (task.quiet || options.quiet) {
    // logs
    const _logger = logger;

    // bypass everything but any given callback
    logger = function $logger() {
      return Promise.resolve().then(() =>
        Promise.all(Array.prototype.slice.call(arguments)
          .filter(cb => typeof cb === 'function')
          .map(cb => cb())));
    };

    // do nothing
    logger.write = () => {};
    logger.printf = () => {};

    // call original logger
    return _logger('Running tasks...', end =>
      run().then(() => end && end('Tasks completed')));
  }

  return run();
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

  /* eslint-disable no-nested-ternary */
  const _logger = (lp.setLogger(options.stdout, options.stderr)
    .setLevel(options.verbose ? 3 : options.debug ? 2 : options.info ? 1 : options.log)
    .getLogger(options.depth));

  // fallback to write() if missing
  _logger.printf = _logger.printf || _logger.write;

  // normalize defaults
  cwd = cwd || options.cwd || process.cwd();

  delete options.cwd;

  // normalize io
  const _config = {
    input: options.stdin,
    output: options.stdout,
  };

  return {
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

      // pass raw-value and rendered-value
      _helpers[name] = () => (text, render) =>
        fn(text, _expr => {
          /* istanbul ignore else */
          if (!_expr) {
            throw new Error(`Missing expression for '${name}' helper`);
          }

          return render(!(_expr.charAt() === '{' && _expr.substr(_expr.length - 1, 1) === '}')
            ? `{{{${_expr}}}}`
            : _expr);
        });

      return this;
    },

    getHelperList() {
      return Object.keys(_helpers).concat(Object.keys(_.HELPERS));
    },

    renderString(value, data) {
      /* istanbul ignore else */
      if (!(value && typeof value === 'string')) {
        throw new Error(`Template must be a string, given '${value}'`);
      }

      return _render(value, data || {}, _helpers, _.HELPERS);
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
          _runTask.call(this, {
            cwd, io: _config, options, defaults,
          }, name, _logger, _helpers));
      }

      return this.getGenerator(name).run(defaults);
    },

    hasGenerator(name) {
      return typeof _tasks[name] !== 'undefined';
    },

    getGeneratorList() {
      return Object.keys(_tasks).map(t => ({
        gen: t,
        name: _tasks[t].description || t,
        value: _tasks[t],
      }));
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

module.exports.closeAll = () => {
  _readlines.splice(0, _readlines.length).forEach(old => {
    /* istanbul ignore else */
    if (old !== null) {
      old.prompter.close();
      old.ui.close();
    }
  });
};
