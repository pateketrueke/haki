'use strict';

/* eslint-disable prefer-rest-params */

const die = process.exit.bind(process);
const _slice = Array.prototype.slice;

const CLR = '\x1b[K';

function echo() {
  process.stdout.write(_slice.call(arguments).join('')
    .replace(/\r\r/g, `${CLR}\r`)
    .replace(/\r\n/g, `${CLR}\n`));
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
  echo,
  merge,
  padding,
};
