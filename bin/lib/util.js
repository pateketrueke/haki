'use strict';

/* eslint-disable prefer-rest-params */

const die = process.exit.bind(process);
const _slice = Array.prototype.slice;

function echo() {
  process.stdout.write(_slice.call(arguments).join(''));
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

module.exports = {
  die,
  echo,
  merge,
};
