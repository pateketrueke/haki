'use strict';

/* eslint-disable global-require */
/* eslint-disable prefer-rest-params */

let Mustache;
let downloadRepo;

// constants

const cp = require('child_process');
const lp = require('log-pose');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const rimraf = require('rimraf');
const _ = require('./constants');

// convert handlebars-like helpers into mustache fn-blocks
const reTransformHelper = /\{\{\s*([a-z]\w+)\s+([.\w]+)\s*\}\}/g;

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

function _prompt($, input) {
  const enquirer = $.haki.getEnquirer();

  // pause earlier
  lp.pause();

  return enquirer.prompt(input.map(p => {
    p.message = p.message || p.name;
    p.type = p.type || 'input';

    /* istanbul ignore else */
    if (p.options) {
      p.choices = p.options.map(c => {
        c = typeof c === 'string' ? { name: c } : c;
        c.message = c.message || c.name;
        return c;
      });

      delete p.options;
    }

    return p;
  }))
    .then(response => {
      lp.resume();

      /* istanbul ignore else */
      if (!Object.keys(response).length) {
        throw new Error('Missing input');
      }

      const out = input.reduce((prev, cur) => {
        /* istanbul ignore else */
        if (typeof response[cur.name] === 'undefined') {
          throw new Error(`Invalid ${cur.name} input`);
        }

        const found = cur.choices && cur.choices
          .find(x => x.name === response[cur.name]);

        prev[cur.name] = found ? (found.value || found.name) : response[cur.name];

        return prev;
      }, {});

      return out;
    })
    .catch(error => {
      lp.resume();
      throw error;
    });
}

function _exec(cmd, currentPath) {
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

function _askIf($, err, label, options, skipFlag) {
  return Promise.resolve()
    .then(() => {
      /* istanbul ignore else */
      if (!err) {
        return;
      }

      /* istanbul ignore else */
      if (skipFlag) {
        return 'skip';
      }

      return _prompt($, [{
        options,
        name: 'action',
        type: 'select',
        message: label,
        default: options[0].value,
      }]).then(({ action }) => action);
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

      return logger('install', _deps.join(' '), end => _exec(args, destPath)
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
    .reduce((prev, cur) => prev.then(() => cur()),
      Promise.resolve()).then(() => result);
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
    task = task(_values, $.haki) || {};
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
    _prompts = _prompts(_values, $.haki) || [];
  }

  /* istanbul ignore else */
  if (typeof _prompts.then === 'function') {
    return _prompts;
  }

  // main
  const run = () => Promise.resolve()
    .then(() => _prompts.length && _prompt($, _prompts))
    .then(response => {
      // merge user input
      Object.assign(_values, response);

      /* istanbul ignore else */
      if (typeof _actions === 'function') {
        _actions = _actions.call($.haki, _values, options) || [];
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
          if (a.src.indexOf('*') !== -1 || (a.src.indexOf('{') && a.src.indexOf('}'))) {
            return glob.sync(a.src, { cwd: task.basePath || '' }).map(x => path.join(task.basePath || '', x));
          }

          /* istanbul ignore else */
          if (!fs.existsSync(path.join(task.basePath || '', a.src))) {
            throw new Error(`Source '${a.src}' does not exists`);
          }

          return [path.join(task.basePath || '', a.src)];
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
              ? fs.readFileSync(path.join(task.basePath || '', a.templateFile)).toString()
              : a.template;

            return _render(tpl, _values, _helpers, _.HELPERS);
          }

          return a.content;
        };

        const _sourceFiles = () => {
          if (typeof _src === 'string' && fs.statSync(_src).isDirectory()) {
            return glob.sync(`${_src}/**/*`, { dot: true, nodir: true });
          }

          return !Array.isArray(_src)
            ? [_src]
            : _src;
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
            return Promise.resolve(a.call($.haki, _values, options));
          }

          const skipMe = a.skipIfExists || task.skipIfExists;

          switch (a.type) {
            case 'copy': {
              _src = _srcPath();

              let _skipAll = false;
              let _replaceAll = false;

              return options.copy !== false && _sourceFiles().reduce((_prev, cur, i) => _prev.then(() => {
                _dest = path.join($.cwd, _render(a.dest || '', _values, _helpers, _.HELPERS), path.relative(path.dirname(_src[i]), cur));

                return logger('write', path.relative($.cwd, _dest), end => _askIf($,
                  _skipAll || _replaceAll ? false : fs.existsSync(_dest) && options.force !== true,
                  `Replace '${path.relative($.cwd, _dest)}'`,
                  _.MULTIPLE_REPLACE_CHOICES, skipMe)
                  .then(result => {
                    /* istanbul ignore else */
                    if (result === 'abort') {
                      throw new Error(`Source '${path.relative($.cwd, _dest)}' won't be copied!`);
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
                      fs.outputFileSync(_dest, _render(fs.readFileSync(cur).toString(), _values, _helpers, _.HELPERS));
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
                const isAfter = !!a.after;
                const pattern = a.after || a.before || a.pattern;

                /* istanbul ignore else */
                if (!(pattern && (typeof pattern === 'string' || pattern instanceof RegExp))) {
                  throw new Error(`Invalid pattern, given '${pattern}'`);
                }

                _tpl = _getTemplate() || '';
                _dest = _destPath();

                /* istanbul ignore else */
                if (!fs.existsSync(_dest)) {
                  if (!a.defaultContent) {
                    throw new Error(`Destination path '${_dest}' is missing`);
                  } else {
                    fs.outputFileSync(_dest, _render(a.defaultContent, _values, _helpers, _.HELPERS));
                  }
                }

                _changes.push({
                  type: a.type,
                  dest: path.relative($.cwd, _dest),
                });

                const unless = typeof a.unless === 'string'
                  ? _render(a.unless, _values, _helpers, _.HELPERS)
                  : a.unless;

                const content = fs.readFileSync(_dest).toString();

                /* istanbul ignore else */
                if (a.unless
                  && (typeof unless === 'string' || unless instanceof RegExp)
                  && (typeof unless === 'string' ? content.indexOf(unless) > -1 : unless.test(content))) {
                  /* istanbul ignore else */
                  if (end) {
                    end(path.relative($.cwd, _dest), 'skip', 'end');
                  }
                  return;
                }

                const regexp = !(pattern instanceof RegExp)
                  ? new RegExp(_render(pattern, _values, _helpers, _.HELPERS))
                  : pattern;

                /* istanbul ignore else */
                if (a.deleteContent && !regexp.test(content)) {
                  /* istanbul ignore else */
                  if (end) {
                    end(path.relative($.cwd, _dest), 'skip', 'end');
                  }
                  return;
                }

                const output = a.deleteContent
                  ? content.replace(regexp, '')
                  : content.replace(regexp, isAfter ? `$&${_tpl}` : `${_tpl}$&`);

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

              return options.clone !== false && logger('clone', _src, end => _askIf($, (fs.existsSync(_dest)
                ? fs.readdirSync(_dest).length !== 0 : false) && options.force !== true,
              `Overwrite '${path.relative($.cwd, _dest) || '.'}' with '${_src}'`,
              _.SINGLE_REPLACE_CHOICES, skipMe)
                .then(result => new Promise((resolve, reject) => {
                  /* istanbul ignore else */
                  if (result === 'abort') {
                    reject(new Error(`Repository '${_src}' won't be cloned!`));
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

              // eslint-disable-next-line
              return options.add !== false && logger('write', path.relative($.cwd, _dest), end => _askIf($, fs.existsSync(_dest) && options.force !== true,
                `Replace '${path.relative($.cwd, _dest)}'`,
                _.SINGLE_REPLACE_CHOICES, skipMe)
                .then(result => {
                  /* istanbul ignore else */
                  if (result === 'abort') {
                    throw new Error(`Source '${path.relative($.cwd, _dest)}' won't be added!`);
                  }

                  /* istanbul ignore else */
                  if (!result || result === 'replace') {
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

              return options.exec !== false && logger('exec', a.command, end => _exec(a.command)
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
              _dest = _destPath();

              return logger('clean', path.relative($.cwd, _dest), end => _askIf($, options.force !== true,
                `Delete '${path.relative($.cwd, _dest) || '.'}'`,
                _.SINGLE_DELETE_CHOICES).then(result => {
                /* istanbul ignore else */
                if (result === 'abort') {
                  throw new Error(`Output '${path.relative($.cwd, _dest) || '.'}' won't be destroyed!`);
                }

                /* istanbul ignore else */
                if (result === 'skip') {
                  /* istanbul ignore else */
                  if (end) {
                    end(path.relative($.cwd, _dest), 'skip', 'end');
                  }
                  return;
                }

                rimraf.sync(_dest);

                if (end) {
                  end();
                }
              }));

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
    .then(() => ({ values: _values, changes: _changes, failures: _failures }))
    .catch(error => {
      /* istanbul ignore else */
      if (task.abortOnFail) {
        throw error;
      }

      return {
        error,
        values: _values,
        changes: _changes,
        failures: _failures,
      };
    });

  /* istanbul ignore else */
  if (task.quiet || options.quiet) {
    // logs
    const _logger = logger;

    // bypass everything but any given callback
    logger = function $logger() {
      return Promise.resolve().then(() => Promise.all(Array.prototype.slice.call(arguments)
        .filter(cb => typeof cb === 'function')
        .map(cb => cb())));
    };

    // do nothing
    logger.write = () => {};
    logger.printf = () => {};

    // call original logger
    return _logger('Running tasks...', end => run().then(() => end && end('Tasks completed')));
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

  let _enquirer;

  return {
    get(opt, defaultValue) {
      return typeof options[opt] === 'undefined'
        ? defaultValue
        : options[opt];
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
      if (!(opts && typeof opts === 'object')) {
        throw new Error(`Prompt options are invalid, given '${opts}'`);
      }

      return _prompt({ haki: this }, !Array.isArray(opts) ? [opts] : opts);
    },

    getEnquirer() {
      if (!_enquirer) {
        const Enquirer = require('enquirer');

        _enquirer = new Enquirer({
          show: options.log !== false,
          stdout: options.stdout,
          stderr: options.stderr,
        });
      }

      return _enquirer;
    },

    getLogger() {
      return _logger;
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
      _helpers[name] = () => (text, render) => fn(text, _expr => {
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
      _tasks[name].run = defaults => this.runGenerator(_tasks[name], defaults);

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
        return Promise.resolve()
          .then(() => _runTask({
            cwd,
            options,
            defaults,
            haki: this,
          }, name, _logger, _helpers));
      }

      return this.getGenerator(name).run(defaults);
    },

    hasGenerator(name) {
      return typeof _tasks[name] !== 'undefined';
    },

    getGeneratorList() {
      return Object.keys(_tasks).map(t => ({
        name: t,
        value: _tasks[t],
        message: _tasks[t].description || t,
      }));
    },

    chooseGeneratorList(defaults) {
      /* istanbul ignore else */
      if (!Object.keys(_tasks).length) {
        throw new Error('There are no registered generators');
      }

      return _prompt({ haki: this }, [{
        name: 'task',
        type: 'list',
        message: 'Choose a generator:',
        options: this.getGeneratorList(),
      }]).then(({ task }) => this.runGenerator(task[0], defaults));
    },
  };
};
