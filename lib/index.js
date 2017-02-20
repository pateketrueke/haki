'use strict';

/* eslint-disable global-require */
/* eslint-disable prefer-rest-params */

let Mustache;
let ReadlineUI;

const cp = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const pluralize = require('pluralize');
const changeCase = require('change-case');

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
    throw new Error(`Unsupported '${_type}' prompt`);
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
  console.log('start', task.command);

  return new Promise((resolve, reject) => {
    console.log(task);
    resolve();
  });
}

function _askIf(io, err, label, success, failure) {
  /* istanbul ignore else */
  if (!err) {
    success();
    return;
  }

  _prompt.call(io, {
    name: 'xxx',
    type: 'expand',
    message: label,
    choices: [
      {
        key: 'y',
        name: 'replace',
        value: 'replace'
      }, {
        key: 'n',
        name: 'do not replace',
        value: 'skip'
      }, {
        key: 'a',
        name: 'replace this and all others',
        value: 'replaceAll'
      }, {
        key: 's',
        name: 'skip this and all others',
        value: 'skipAll'
      }, {
        key: 'x',
        name: 'abort',
        value: 'end'
      }, {
        key: 'd',
        name: 'show the differences between the old and the new',
        value: 'diff'
      },
    ],
  }, (_err, value) => {
    if (_err) {
      failure(_err);
    } else {
      console.log(value, '!!!');
      success();
    }
  });
}

function _runTask($, task) {
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

  // normalize task actions and params
  let _actions = task.actions || [];
  let _prompts = task.prompts || [];

  /* istanbul ignore else */
  if (typeof _prompts === 'function') {
    _prompts = _prompts(_values, this) || {};
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
      return _actions.then((result) => {
        // merge given results
        _merge(_changes, result.changes);
        _merge(_failures, result.failures);
      });
    }

    return Promise.all(_actions.map((a) =>
      typeof a === 'function' ? Promise.resolve(a.call(this, _values, options)) : new Promise((resolve, reject) => {
        /* istanbul ignore else */
        if (!(a.destPath && typeof a.destPath === 'string')) {
          throw new Error('Destination file is missing');
        }

        const src = a.srcPath ? path.join(task.basePath || '', _render(a.srcPath, _values, HELPERS)) : null;
        const dest = a.destPath ? path.join($.cwd, _render(a.destPath, _values, HELPERS)) : null;

        let tpl;

        /* istanbul ignore else */
        if (a.template || a.templateFile) {
          tpl = a.templateFile
              ? path.join(task.basePath || '', a.templateFile)
              : a.template;

          tpl = _render(fs.existsSync(tpl) ? fs.readFileSync(tpl).toString() : tpl, _values, HELPERS);
        }

        try {
          /* istanbul ignore else */
          if (src && !fs.existsSync(src)) {
            throw new Error(`File '${src}' does not exists`);
          }

          switch (a.type) {
            case 'modify':
              /* istanbul ignore else */
              if (!(a.pattern && (typeof a.pattern === 'string' || a.pattern instanceof RegExp))) {
                throw new Error('Modify pattern is missing');
              }

              /* istanbul ignore else */
              if (!(tpl && typeof tpl === 'string')) {
                throw new Error('Modify template is missing');
              }

              return _askIf($.io, options.force !== true,
                `Save changes to '${path.relative($.cwd, dest)}'`,
                () => {
                  const out = fs.readFileSync(dest).toString()
                    .replace(a.pattern, _render(tpl, _values, HELPERS));

                  fs.outputFileSync(dest, out);

                  _changes.push({
                    type: a.type,
                    destPath: path.relative($.cwd, dest),
                  });

                  resolve();
                }, reject);

            case 'copy':
              /* istanbul ignore else */
              if (!(src && typeof src === 'string')) {
                throw new Error('Source file is missing');
              }

              /* istanbul ignore else */
              if (!fs.existsSync(src)) {
                throw new Error(`File '${tpl}' does not exists`);
              }

              return _askIf($.io, fs.existsSync(dest) && options.force !== true,
                `Replace file '${path.relative($.cwd, dest)}'`,
                () => {
                  fs.copySync(src, dest);

                  _changes.push({
                    type: a.type,
                    destPath: path.relative($.cwd, dest),
                  });

                  resolve();
                }, reject);

            case 'add':
              return _askIf($.io, fs.existsSync(dest) && options.force !== true,
                `Overwrite file '${path.relative($.cwd, dest)}'`,
                () => {
                  fs.outputFileSync(dest, _render(tpl || '', _values, HELPERS));

                  _changes.push({
                    type: a.type,
                    destPath: path.relative($.cwd, dest),
                  });

                  resolve();
                }, reject);

            case 'run':
              /* istanbul ignore else */
              if (!(a.cmd && (typeof a.cmd === 'string' || a.cmd instanceof RegExp))) {
                throw new Error('Execute command is missing');
              }

              return _exec($.io, a);

            default:
              throw new Error(`Unsupported '${a.type}' action`);
          }
        } catch (e) {
          _failures.push({
            error: e,
            type: a.type,
            destPath: path.relative($.cwd, dest),
          });

          /* istanbul ignore else */
          if (a.abortOnFail) {
            reject(e);
          }
        } finally {
          resolve();
        }
      })));
  })
  .then(() => ({ changes: _changes, failures: _failures }));
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
        _prompt(opts, (err, value) => {
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
        _runTask.call(this, { cwd, io: _config, options, defaults }, _tasks[name]);

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
