'use strict';

/* eslint-disable global-require */
/* eslint-disable prefer-rest-params */

let interval;
let Mustache;
let downloadRepo;

// constants

const exts = require('text-extensions');
const cp = require('child_process');
const lp = require('log-pose');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const rimraf = require('rimraf');
const _ = require('./constants');

// convert handlebars-like helpers into mustache fn-blocks
const reTransformHelper = /\{\{\s*([a-z]\w+)\s+([.\w]+)\s*\}\}/g;

function _tags(str, root) {
  const info = {
    filepath: root || null,
    input: [],
  };

  /* istanbul ignore else */
  if (str.indexOf('{{') === -1 || str.indexOf('}}') === -1) {
    return info;
  }

  /* istanbul ignore else */
  if (str.indexOf('{{#') !== -1) {
    const matches = str.match(/\{\{#([^#{}]+)\}\}([\s\S]+?)\{\{\/\1\}\}/g);

    info.input = (matches || []).reduce((memo, x) => {
      const prop = x.match(/\{\{#\w+\}\}/)[0];

      str = str.replace(x, '');

      return memo.concat({
        key: prop.substr(3, prop.length - 5),
        ..._tags(x.substr(prop.length, x.length - (prop.length * 2)), root),
      });
    }, []);
  }

  info.input.push(...(str.match(/\{\{[^{#}]+\}\}/g) || []).map(x => ({
    key: x.substr(2, x.length - 4).split(' ').pop(),
    input: [],
  })));

  return info;
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

function _prompt($, input) {
  const prompter = $.haki.getPrompts();

  // pause earlier
  clearTimeout(interval);
  lp.pause();

  return prompter(input.map(p => {
    p.message = p.message || p.name || 'value';
    p.type = p.type || 'text';

    /* istanbul ignore else */
    if (p.options) {
      throw new Error('Deprecated usage of `options`, use `choices` instead');
    }

    return p;
  }))
    .then(response => {
      interval = setTimeout(() => lp.resume());

      /* istanbul ignore else */
      if (!Object.keys(response).length) {
        throw new Error('Missing input');
      }

      const out = input.reduce((prev, cur) => {
        /* istanbul ignore else */
        if (typeof response[cur.name] === 'undefined') {
          throw new Error(`Invalid '${cur.name}' input`);
        }

        const found = cur.choices && cur.choices
          .find(x => x.title === response[cur.name]);

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
        name: 'action',
        type: 'select',
        message: label,
        choices: options,
        default: options[0].name,
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

      /* istanbul ignore else */
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

  return tasks.reduce((prev, cur) => prev.then(() => cur()),
    Promise.resolve()).then(() => result);
}

function _promptly($, logger, localVars, fixedTasks) {
  /* istanbul ignore else */
  if (!fixedTasks.input.length) {
    return Promise.resolve();
  }

  /* istanbul ignore else */
  if (fixedTasks.filepath) {
    logger.printf('{% log %s %}\r\r\n', fixedTasks.filepath);
  }

  const queue = [];
  const input = {};

  fixedTasks.input.forEach(x => {
    /* istanbul ignore else */
    if (typeof localVars[x.key] === 'undefined') {
      localVars[x.key] = null;
      queue.push(() => new Promise((ok, fail) => {
        const onError = e => fail(fixedTasks.filepath ? new Error(`${e.message} at ${fixedTasks.filepath}`) : e);
        const field = { name: x.key };

        /* istanbul ignore else */
        if (x.input.length > 0) {
          field.message = `${x.key}?`;
          field.type = 'confirm';
        }

        _prompt($, [field])
          .then(response => {
            /* istanbul ignore else */
            if (response[x.key] && x.input.length > 0) {
              const fill = y => _promptly($, logger, y || localVars, x).then(vars => {
                if (!input[x.key]) {
                  input[x.key] = vars;
                } else {
                  /* istanbul ignore else */
                  if (!Array.isArray(input[x.key])) {
                    input[x.key] = [input[x.key]];
                  }

                  input[x.key].push(vars);
                }

                return _prompt($, [{ name: x.key, type: 'confirm', message: `Add more ${x.key} items?` }])
                  .then(result => {
                    if (result[x.key]) fill({});
                    else ok();
                  });
              }).catch(onError);
              fill();
            } else {
              input[x.key] = response[x.key];
              ok();
            }
          }).catch(onError);
      }));
    }
  });

  return queue.reduce((prev, cur) => prev.then(() => cur()), Promise.resolve()).then(() => input);
}

function _template($, logger, _values, _renderize, destPath, finishCallback) {
  let srcFiles;

  if (typeof destPath === 'string' && fs.statSync(destPath).isDirectory()) {
    srcFiles = glob.sync(`${destPath}/**/*`, { dot: true, nodir: true });
  } else {
    srcFiles = !Array.isArray(destPath)
      ? [destPath]
      : destPath;
  }

  srcFiles.reduce((prev, file) => {
    return prev.then(() => _promptly($, logger, _values, _tags(file, file.replace($.cwd, '.'))).then(_vars => {
      Object.assign(_values, _vars);
    })).then(() => {
      const newFile = _renderize(file, _values);

      let body = null;
      let changed;

      /* istanbul ignore else */
      if (newFile !== file) {
        changed = true;
      }

      return Promise.resolve()
        .then(() => {
          const ext = path.extname(file).substr(1);

          /* istanbul ignore else */
          if (exts.includes(ext) && !_.EXTS.includes(ext)) {
            const content = fs.readFileSync(file).toString();

            return _promptly($, logger, _values, _tags(content)).then(_vars => {
              Object.assign(_values, _vars);
            }).then(() => {
              body = _renderize(content, _values);

              /* istanbul ignore else */
              if (body === content) {
                body = null;
              }
            }).catch(finishCallback);
          }
        })
        .then(() => {
          /* istanbul ignore else */
          if (body !== null || changed) {
            if (body !== null) {
              /* istanbul ignore else */
              if (newFile !== file) fs.unlinkSync(file);
              fs.outputFileSync(newFile, body);
            } else {
              fs.renameSync(file, newFile);
            }
          }
        });
    }).catch(finishCallback);
  }, Promise.resolve()).then(() => finishCallback());
}

function _runTask($, task, logger, _helpers) {
  const _values = {};

  const _changes = [];
  const _failures = [];

  // normalize input
  const options = $.options || {};

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

  // main
  const run = () => Promise.resolve()
    .then(() => {
      let _prompts = task.prompts || [];

      /* istanbul ignore else */
      if (typeof _prompts === 'function') {
        _prompts = _prompts(_values, $.haki) || [];
      }

      /* istanbul ignore else */
      if (typeof _prompts.then === 'function') {
        return _prompts;
      }

      // filter out pending input
      _prompts = _prompts
        .filter(p => {
          /* istanbul ignore else */
          if (typeof _values[p.name] === 'undefined') {
            /* istanbul ignore else */
            if (!p.validate
              && typeof task.validate === 'object'
              && typeof task.validate[p.name] === 'function') {
              p.validate = task.validate[p.name];
            }

            return true;
          }

          return false;
        });

      return (_prompts.length && _prompt($, _prompts)) || undefined;
    })
    .then(response => {
      // merge user input
      Object.assign(_values, $.defaults, task.defaults, response);

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
          /* istanbul ignore else */
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

        const _renderize = (tpl, _extra) => {
          return _render(tpl, { ..._values, ..._extra }, _helpers, _.HELPERS);
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
                  /* istanbul ignore else */
                  if (!a.defaultContent) {
                    throw new Error(`Missing ${path.relative($.cwd, _dest)} file`);
                  }

                  fs.outputFileSync(_dest, _render(a.defaultContent, _values, _helpers, _.HELPERS));
                }

                _changes.push({
                  type: a.type,
                  dest: path.relative($.cwd, _dest),
                });

                const unless = typeof a.unless === 'string'
                  ? new RegExp(_render(a.unless, _values, _helpers, _.HELPERS))
                  : a.unless;

                const content = fs.readFileSync(_dest).toString();

                /* istanbul ignore else */
                if (a.unless && (unless instanceof RegExp && unless.test(content))) {
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
                  /* istanbul ignore else */
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
                      _template($, logger, _values, _renderize, _dest,
                        _err => {
                          /* istanbul ignore else */
                          if (_err) return reject(_err);

                          _changes.push({
                            type: a.type,
                            repository: _src,
                          });

                          resolve();
                        });
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

                  /* istanbul ignore else */
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

                /* istanbul ignore else */
                if (end) {
                  end();
                }
              }));

            case 'render':
              return Promise.all((Array.isArray(a.dest) ? a.dest : [a.dest])
                .map(dir => new Promise(_resolve => _template($, logger, _values, _renderize, path.join($.cwd, dir), _err => {
                  /* istanbul ignore else */
                  if (_err) throw _err;
                  _resolve();
                }))));

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
      if (!(opts && typeof opts === 'object')) {
        throw new Error(`Prompt options are invalid, given '${opts}'`);
      }

      return _prompt({ haki: this }, !Array.isArray(opts) ? [opts] : opts);
    },

    getPrompts() {
      return require('prompts');
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

    getGeneratorList(hints) {
      return Object.keys(_tasks).map(t => ({
        name: t,
        message: (_tasks[t].description
          && (hints && `${t} - ${_tasks[t].description}`))
          || _tasks[t].description
          || t,
      }));
    },

    chooseGeneratorList(defaults) {
      /* istanbul ignore else */
      if (!Object.keys(_tasks).length) {
        throw new Error('There are no registered generators');
      }

      return _prompt({ haki: this }, [{
        name: 'task',
        type: 'autocomplete',
        message: 'Choose a generator:',
        choices: this.getGeneratorList(true),
      }]).then(({ task }) => this.runGenerator(task, defaults));
    },
  };
};
