'use strict';

/* eslint-disable prefer-rest-params */

const die = process.exit.bind(process);

function extend(target) {
  Array.prototype.slice.call(arguments, 1).forEach(source => {
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
  extend,
  padding,
};
