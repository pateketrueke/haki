'use strict';

/* eslint-disable prefer-rest-params */

const die = process.exit.bind(process);
const _slice = Array.prototype.slice;

const CLR = '\x1b[K';

const symbols = {
  ok: '✔',
  err: '✗',
  log: '—',
  diff: '≠',
  warn: '⚠',
  info: 'ℹ',
  hint: '›',
  wait: '↺',
};

function puts(message) {
  const args = Array.prototype.slice.call(arguments, 1);

  return String(message)
    .replace(/\r\r/g, `${CLR}\r`)
    .replace(/\r\n/g, `${CLR}\n`)
    .replace(/%s/g, () => args.shift());
}

function merge(target) {
  _slice.call(arguments, 1).forEach(source => {
    Object.keys(source).forEach(key => {
      /* istanbul ignore else */
      if (typeof target[key] === 'undefined') {
        target[key] = source[key];
      }
    });
  });

  return target;
}

function padding(value, max) {
  return `${value}${new Array(value.length + max).join(' ')}`.substr(0, max);
}

module.exports = {
  die,
  puts,
  merge,
  padding,
  symbols,
};
