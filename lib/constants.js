'use strict';

const pluralize = require('pluralize');
const changeCase = require('change-case');

const MULTIPLE_REPLACE_CHOICES = [
  {
    name: 'Do not replace',
    value: 'skip',
  }, {
    name: 'Replace it',
    value: 'replace',
  }, {
    name: 'Replace this and all others',
    value: 'replaceAll',
  }, {
    name: 'Skip this and all others',
    value: 'skipAll',
  }, {
    name: 'Abort',
    value: 'abort',
  },
];

const SINGLE_REPLACE_CHOICES = [
  {
    name: 'Do not replace',
    value: 'skip',
  }, {
    name: 'Replace it',
    value: 'replace',
  }, {
    name: 'Abort',
    value: 'abort',
  },
];

const SINGLE_DELETE_CHOICES = [
  {
    name: 'Do not delete',
    value: 'skip',
  }, {
    name: 'Delete it',
    value: 'delete',
  }, {
    name: 'Abort',
    value: 'abort',
  },
];

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
  HELPERS,
  SHORTHANDS,
  DEPS,
};
