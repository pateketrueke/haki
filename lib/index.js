'use strict';

/* eslint-disable global-require */
/* eslint-disable prefer-rest-params */

const fs = require('fs-extra');
const path = require('path');

const Mustache = require('mustache');
const pluralize = require('pluralize');
const changeCase = require('change-case');
const ReadlineUI = require('readline-ui');

// convert handlebars-like helpers into mustache fn-blocks
const reTransformHelper = /\{\{\s*(\w+)\s+([.\w]+)\s*\}\}/g;

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

const _slice = Array.prototype.slice;

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

function _merge(obj, data) {
  Object.keys(data).forEach((key) => {
    obj[key] = data[key];
  });

  return obj;
}

function _render(str) {
  const args = _slice.call(arguments, 1);
  const obj = args.reduce((prev, x) => _merge(prev, x), {});

  return Mustache.render(str.replace(reTransformHelper, '{{#$1}}$2{{/$1}}'), obj);
}

function _prompt(config, opts, cb) {
  const _type = opts.type || 'input';

  try {
    /* istanbul ignore else */
    if (typeof PROMPTS[_type] !== 'function') {
      PROMPTS[_type] = require(PROMPTS[_type]);
    }
  } catch (e) {
    throw new Error(`Unsupported '${_type}' prompt`);
  }

  // let output as ttys
  const ui = new ReadlineUI(config.io);

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

function _runTask(task, options) {
  const _cache = {};
  const _values = {};

  const _changes = [];
  const _failures = [];

  const defaults = options.defaults || {};

  // merge initial values
  Object.keys(defaults).forEach((key) => {
    _values[key] = defaults[key];
  });

  // normalize task actions
  let _actions = task.actions || [];

  return (task.prompts || []).reduce((prev, p) =>
    prev.then(() => new Promise((resolve, reject) => {
      /* istanbul ignore else */
      if (_values[p.name] && _values[p.name].length) {
        resolve();
        return;
      }

      _prompt(options, p, (err, value) => {
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
      _actions = _actions(_values) || [];
    }

    return Promise.all(_actions.map((a) =>
      typeof a === 'function' ? Promise.resolve(a(_values, this)) : new Promise((resolve, reject) => {
        /* istanbul ignore else */
        if (!(a.destFile && typeof a.destFile === 'string')) {
          throw new Error('Destination file is missing');
        }

        const dest = _render(path.join(options.cwd, a.destFile), _values, HELPERS);

        try {
          let tpl;

          // resolve
          if (a.templateFile) {
            tpl = task.basePath ? path.join(task.basePath, a.templateFile) : a.templateFile;

            /* istanbul ignore else */
            if (!fs.existsSync(tpl)) {
              throw new Error(`Template '${tpl}' does not exists`);
            }

            /* istanbul ignore else */
            if (!_cache[tpl]) {
              _cache[tpl] = fs.readFileSync(tpl).toString();
            }

            tpl = _cache[tpl];
          } else {
            tpl = a.template || '';
          }

          tpl = _render(tpl, _values, HELPERS);

          switch (a.type) {
            case 'modify':
              /* istanbul ignore else */
              if (!(a.pattern && (typeof a.pattern === 'string' || a.pattern instanceof RegExp))) {
                throw new Error('Modify pattern is missing');
              }

              fs.outputFileSync(dest, fs.readFileSync(dest).toString().replace(a.pattern, tpl));

              _changes.push({
                type: a.type,
                destFile: path.relative(options.cwd, dest),
              });
              break;

            case 'copy':
              /* istanbul ignore else */
              if (!(a.srcFile && typeof a.srcFile === 'string')) {
                throw new Error('Source file is missing');
              }

              const src = _render(path.join(options.cwd, a.srcFile), _values, HELPERS);

              /* istanbul ignore else */
              if (!fs.existsSync(src)) {
                throw new Error(`File '${path.relative(options.cwd, src)}' does not exists`);
              }

              /* istanbul ignore else */
              if (fs.existsSync(dest) && options.overwrite !== true) {
                throw new Error(`File '${path.relative(options.cwd, dest)}' already exists`);
              }

              fs.copySync(src, dest);

              _changes.push({
                type: a.type,
                srcFile: path.relative(options.cwd, src),
                destFile: path.relative(options.cwd, dest),
              });
              break;

            case 'add':
              /* istanbul ignore else */
              if (fs.existsSync(dest) && options.overwrite !== true) {
                throw new Error(`File '${path.relative(options.cwd, dest)}' already exists`);
              }

              fs.outputFileSync(dest, tpl);

              _changes.push({
                type: a.type,
                destFile: path.relative(options.cwd, dest),
              });
              break;

            default:
              throw new Error(`Unsupported '${a.type}' action`);
          }
        } catch (e) {
          /* istanbul ignore else */
          if (a.abortOnFail) {
            reject(e);
            return;
          }

          _failures.push({
            error: e.message || e.toString(),
            type: a.type,
            destFile: path.relative(options.cwd, dest),
          });
        }

        resolve();
      })));
  })
  .then(() => ({ changes: _changes, failures: _failures }))
  .catch(error => ({ error, changes: _changes, failures: _failures }));
}

module.exports = function Haki(cwd, stdin, stdout) {
  const _helpers = {};
  const _tasks = {};

  // normalize defaults
  cwd = cwd || process.cwd();

  // normalize io
  const _config = {
    input: stdin,
    output: stdout,
  };

  return {
    load(file) {
      try {
        file = require.resolve(file);
      } catch (e) {
        file = path.resolve(cwd, file);
      }

      require(file)(this);

      return this;
    },

    getPath(dest) {
      return path.join(cwd, dest || '');
    },

    addHelper(name, fn) {
      _helpers[name] = fn;

      return this;
    },

    getHelperList() {
      return Object.keys(_helpers).concat(Object.keys(HELPERS));
    },

    renderString(value, data) {
      return _render(value, data || {}, _helpers, HELPERS);
    },

    setGenerator(name, opts) {
      /* istanbul ignore else */
      if (!(name && typeof name === 'string')) {
        throw new Error(`Generator name must be a string, given '${name}'`);
      }

      _tasks[name] = opts || {};
      _tasks[name].run = (defaults, overwrite) =>
        _runTask.call(this, _tasks[name], { cwd, io: _config, defaults, overwrite });

      return this;
    },

    getGenerator(name) {
      return _tasks[name];
    },

    runGenerator(name, defaults, overwrite) {
      return _runTask.call(this, _tasks[name], { cwd, io: _config, defaults, overwrite });
    },

    getGeneratorList() {
      return Object.keys(_tasks).map(t => ({ name: t, task: _tasks[t] }));
    },

    chooseGeneratorList(callback) {
      /* istanbul ignore else */
      if (!Object.keys(_tasks).length) {
        throw new Error('There are no registered generators');
      }

      _prompt(_config, {
        name: 'task',
        type: 'list',
        message: 'Choose a generator:',
        choices: this.getGeneratorList().map(t => t.name),
      }, (err, value) => {
        _runTask.call(this, _tasks[value], { cwd, io: _config })
          .then(result => typeof callback === 'function' && callback(err, result));
      });
    }
  };
};
