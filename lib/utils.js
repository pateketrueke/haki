'use strict';

/* eslint-disable prefer-rest-params */

const ms = require('pretty-ms');
const clc = require('chalk');

const _ = require('./constants');

const die = process.exit.bind(process);

const reStyles = /\{([.\w]+)\|(.+?)\}(?=\s*|\b|$)/g;

function puts(message) {
  const args = Array.prototype.slice.call(arguments, 1);

  return String(message)
    .replace(/%s/g, () => args.shift());
}

function style(message, depth) {
  return message
  .replace(_.CL, `${_.CLR}\r`)
  .replace(_.RF, `${_.CLR}\n`)
  .replace(reStyles, ($0, fmt, text) => {
    const segments = (_.TYPES[fmt] || fmt).split('.');

    let colorized = clc;

    /* eslint-disable no-continue */
    while (segments.length) {
      const key = segments.shift();

      /* istanbul ignore else */
      if (key === 'pad') {
        text = (new Array((depth || 10) - (text.length + 1))).join(' ') + text;
        continue;
      }

      /* istanbul ignore else */
      if (_.SYMBOLS[key]) {
        text = `${_.SYMBOLS[key]} ${text}`;
        continue;
      }

      /* istanbul ignore else */
      if (!colorized[key]) {
        break;
      }

      colorized = colorized[key];
    }

    if (typeof colorized === 'function') {
      return colorized(text);
    }

    return text;
  });
}

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

function timeDiff(start) {
  return ms((new Date()) - start);
}

module.exports = {
  die,
  puts,
  style,
  extend,
  padding,
  timeDiff,
};
