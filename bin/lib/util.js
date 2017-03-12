'use strict';

/* eslint-disable prefer-rest-params */

const die = process.exit.bind(process);
const _slice = Array.prototype.slice;

function echo() {
  process.stdout.write(_slice.call(arguments).join(''));
}

module.exports = {
  die,
  echo,
};
