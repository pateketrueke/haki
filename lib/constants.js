'use strict';

const pluralize = require('pluralize');
const changeCase = require('change-case');

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

const LOG_LEVELS = [0, 'info', 'debug', 'verbose'];

const SYMBOLS = {
  ok: '✔',
  err: '✗',
  log: '—',
  diff: '≠',
  warn: '⚠',
  info: 'ℹ',
  hint: '›',
  wait: '↺',
};

const TYPES = {
  important: 'ok.bgRed.white',
  delete: 'ok.red.bold',
  ok: 'ok.green',
  err: 'err.red',
  log: 'log.gray',
  fail: 'warn.red',
  diff: 'diff.magenta',
  info: 'info.blue',
  hint: 'hint.gray',
  wait: 'wait.yellow',
};

const DEPS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const CLR = '\x1b[K';

const CL = /\r\r/g;
const RF = /\r\n/g;

module.exports = {
  MULTIPLE_CHOICES,
  SINGLE_CHOICES,
  PROMPTS,
  HELPERS,
  SHORTHANDS,
  LOG_LEVELS,
  SYMBOLS,
  TYPES,
  DEPS,
  CLR,
  CL,
  RF,
};
