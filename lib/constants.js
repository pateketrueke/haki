'use strict';

const pluralize = require('pluralize');
const changeCase = require('change-case');

const MULTIPLE_REPLACE_CHOICES = [
  {
    message: 'Do not replace',
    name: 'skip',
  }, {
    message: 'Replace it',
    name: 'replace',
  }, {
    message: 'Replace this and all others',
    name: 'replaceAll',
  }, {
    message: 'Skip this and all others',
    name: 'skipAll',
  }, {
    message: 'Abort',
    name: 'abort',
  },
];

const SINGLE_REPLACE_CHOICES = [
  {
    message: 'Do not replace',
    name: 'skip',
  }, {
    message: 'Replace it',
    name: 'replace',
  }, {
    message: 'Abort',
    name: 'abort',
  },
];

const SINGLE_DELETE_CHOICES = [
  {
    message: 'Do not delete',
    name: 'skip',
  }, {
    message: 'Delete it',
    name: 'delete',
  }, {
    message: 'Abort',
    name: 'abort',
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

const EXTS = ['hbs', 'handlebars', 'mustache'];

module.exports = {
  MULTIPLE_REPLACE_CHOICES,
  SINGLE_REPLACE_CHOICES,
  SINGLE_DELETE_CHOICES,
  HELPERS,
  SHORTHANDS,
  DEPS,
  EXTS,
};
