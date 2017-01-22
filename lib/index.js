'use strict';

/* eslint-disable global-require */
/* eslint-disable prefer-rest-params */

const fs = require('fs-extra');
const path = require('path');

const chalk = require('chalk');
const promptly = require('promptly');
const Mustache = require('mustache');
const pluralize = require('pluralize');
const changeCase = require('change-case');

// convert handlebars-like helpers into mustache fn-blocks
const reTransformHelper = /\{\{\s*(\w+)\s+(\w+)\s*\}\}/g;

const HELPERS = {
  singularize: () => (text, render) => pluralize.singular(render(text)),
  pluralize: () => (text, render) => pluralize.plural(render(text)),
};

// apply common helpers
`dotCase swapCase pathCase upperCase lowerCase camelCase snakeCase titleCase
paramCase headerCase pascalCase constantCase sentenceCase ucFirst lcFirst`
.split(/\s+/).map((fn) => {
  HELPERS[fn] = () => (text, render) => changeCase[fn](render(text));
});

const _slice = Array.prototype.slice;

function _echo() {
  process.stdout.write(_slice.call(arguments).join(''));
}

function _merge(obj, data) {
  Object.keys(data).forEach((key) => {
    obj[key] = data[key];
  });
}

function _render(str) {
  const args = _slice.call(arguments, 1);
  const obj = {};

  args.forEach((_data) => {
    _merge(obj, _data);
  });

  return Mustache.render(str.replace(reTransformHelper, '{{#$1}}{{$2}}{{/$1}}'), obj);
}

function _runTask(cwd, task, defaults, overwrite) {
  const _cache = {};
  const _values = {};

  const _changes = [];
  const _failures = [];

  defaults = defaults || {};

  // merge initial values
  Object.keys(defaults).forEach((key) => {
    _values[key] = defaults[key];
  });

  // normalize task actions
  let _actions = task.actions || [];

  return task.prompts.reduce((prev, p) =>
    prev.then(() => new Promise((resolve, reject) => {
      /* istanbul ignore else */
      if (_values[p.name] && _values[p.name].length) {
        resolve();
        return;
      }

      const _message = chalk.gray(`› ${p.message}`);
      const _params = {};

      _params.validator = [v => (p.validate || (x => x))(v) || v];
      _params.default = p.default || '';
      _params.retry = p.retry || false;
      _params.trim = true;

      function _end(err, value) {
        /* istanbul ignore else */
        if (err) {
          reject(err);
          return;
        }

        _values[p.name] = value;

        resolve();
      }

      if (p.caption) {
        _echo(chalk.gray(p.caption), '\n');
      }

      if (p.type === 'choose') {
        p.options.forEach((option, i) => {
          _echo(chalk.gray(`  ${i + 1})`), ' ', chalk.cyan(option), '\n');
        });

        _params.validator.push(value => p.options[value - 1] || value);

        promptly[p.type](_message, p.options, _params, _end);
      } else {
        promptly[p.type](_message, _params, _end);
      }
    }))
  , Promise.resolve())
  .then(() => {
    /* istanbul ignore else */
    if (typeof _actions === 'function') {
      _actions = _actions(_values) || [];
    }

    return Promise.all(_actions.map((a) =>
      typeof a === 'function' ? Promise.resolve(a(_values, this)) : new Promise((resolve, reject) => {
        const dest = _render(path.join(cwd, a.destFile), _values, HELPERS);

        try {
          let tpl;

          // resolve
          if (a.templateFile) {
            tpl = path.join(task.basePath, a.templateFile);

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
              fs.outputFileSync(dest, fs.readFileSync(dest).toString().replace(a.pattern, tpl));

              _changes.push({
                type: a.type,
                destFile: path.relative(cwd, dest),
              });
              break;

            case 'copy':
              const src = _render(path.join(cwd, a.srcFile), _values, HELPERS);

              /* istanbul ignore else */
              if (!fs.existsSync(src)) {
                throw new Error(`File '${path.relative(cwd, src)}' does not exists`);
              }

              /* istanbul ignore else */
              if (fs.existsSync(dest) && overwrite !== true) {
                throw new Error(`File '${path.relative(cwd, dest)}' already exists`);
              }

              fs.copySync(src, dest);

              _changes.push({
                type: a.type,
                srcFile: path.relative(cwd, src),
                destFile: path.relative(cwd, dest),
              });
              break;

            case 'add':
              /* istanbul ignore else */
              if (fs.existsSync(dest) && overwrite !== true) {
                throw new Error(`File '${path.relative(cwd, dest)}' already exists`);
              }

              fs.outputFileSync(dest, tpl);

              _changes.push({
                type: a.type,
                destFile: path.relative(cwd, dest),
              });
              break;

            default:
              throw new Error(`Unsupported type '${a.type}' action`);
          }
        } catch (e) {
          /* istanbul ignore else */
          if (a.abortOnFail) {
            reject(e);
            return;
          }

          _failures.push({
            error: e.message,
            type: a.type,
            destFile: path.relative(cwd, dest),
          });
        }

        resolve();
      })));
  })
  .then(() => ({ changes: _changes, failures: _failures }))
  .catch((error) => ({ error, changes: _changes, failures: _failures }));
}

module.exports = function Haki(cwd) {
  const _helpers = {};
  const _tasks = {};

  // normalize defaults
  cwd = cwd || process.cwd();

  return {
    load(file) {
      try {
        file = require.resolve(file);
      } catch (e) {
        file = path.resolve(cwd, file);
      }

      require(file)(this);
    },

    getPath(dest) {
      return path.join(cwd, dest || '');
    },

    addHelper(name, fn) {
      _helpers[name] = fn;
    },

    getHelperList() {
      return Object.keys(_helpers).concat(Object.keys(HELPERS));
    },

    renderString(value, data) {
      return _render(value, data || {}, _helpers, HELPERS);
    },

    setGenerator(name, opts) {
      _tasks[name] = opts;
      _tasks[name].run = (defaults, overwrite) =>
        _runTask.call(this, cwd, _tasks[name], defaults, overwrite);
    },

    getGenerator(name) {
      return _tasks[name];
    },

    runGenerator(name, defaults, overwrite) {
      return _runTask.call(this, cwd, _tasks[name], defaults, overwrite);
    },

    getGeneratorList() {
      return Object.keys(_tasks).map(t => ({ name: t, task: _tasks[t] }));
    },
  };
};
