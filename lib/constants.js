'use strict';

const pluralize = require('pluralize');
const changeCase = require('change-case');

const MULTIPLE_REPLACE_CHOICES = [
  {
    key: 'n',
    name: 'Do not replace',
    value: 'skip',
  }, {
    key: 'y',
    name: 'Replace it',
    value: 'replace',
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

const SINGLE_REPLACE_CHOICES = [
  {
    key: 'n',
    name: 'Do not replace',
    value: 'skip',
  }, {
    key: 'y',
    name: 'Replace it',
    value: 'replace',
  }, {
    key: 'x',
    name: 'Abort',
    value: 'abort',
  },
];

const SINGLE_DELETE_CHOICES = [
  {
    key: 'n',
    name: 'Do not delete',
    value: 'skip',
  }, {
    key: 'y',
    name: 'Delete it',
    value: 'delete',
  }, {
    key: 'x',
    name: 'Abort',
    value: 'abort',
  },
];

const PROMPTS = {
  sort: 'prompt-sort',
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
  singularize: () => (text, render) => pluralize.singular(render(`{{{${text}}}}`)),
  pluralize: () => (text, render) => pluralize.plural(render(`{{{${text}}}}`)),
  tableName: () => (...x) => changeCase.snakeCase(HELPERS.pluralize()(...x)),
};

// apply common helpers
Object.keys(changeCase).forEach(k => {
  /* istanbul ignore else */
  if (k.indexOf('is') !== 0) {
    HELPERS[k] = () => (text, render) => changeCase[k](render(`{{{${text}}}}`));
  }
});

const SHORTHANDS = {
  from: 'src',
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

module.exports = {
  MULTIPLE_REPLACE_CHOICES,
  SINGLE_REPLACE_CHOICES,
  SINGLE_DELETE_CHOICES,
  PROMPTS,
  HELPERS,
  SHORTHANDS,
  DEPS,
};
