'use strict';

const _ = require('./constants');
const $ = require('./utils');

let logger;

// disabled
let current = false;

/* eslint-disable prefer-rest-params */
/* eslint-disable prefer-spread */

function log(allowed, format, depth, cb) {
  return function _log() {
    if (cb && (allowed - 1) < current) {
      if (format !== null) {
        cb(format !== false
          ? $.style(`\r\r${$.puts.apply(null, arguments)}`, depth)
          : $.puts.apply(null, arguments));
      } else {
        cb($.style($.puts.apply(null, arguments), depth));
      }
    }

    return this;
  };
}

function status(start, type, out, cb) {
  if (!(start instanceof Date)) {
    cb = out;
    out = type || {};
    type = start || 'log';
    start = new Date();
  }

  if (typeof type === 'object') {
    cb = out;
    out = type || {};
    type = out.type || 'unknown';
  }

  const ok = this.isEnabled();

  let dest = (out && typeof out === 'object') ? out.dest : out;
  let src = (out && typeof out === 'object') ? out.src : out;

  if (src) {
    if (Array.isArray(src) && src.length > 1) {
      src = `[${src.length} file${src.length !== 1 ? 's' : ''}]`;
    } else {
      src = (src || '').toString();
    }
  }

  if (cb && typeof cb !== 'function') {
    throw new Error(`Expected callback, given '${cb}'`);
  }

  src = src || '?';
  dest = dest || src || '?';

  let err;
  let retval;

  try {
    if (cb) {
      this.printf('\r\r  {pad.gray|%s} {wait.gray|%s ...}', type, src);
      retval = cb();
    }
  } catch (e) {
    err = e;
  }

  function end(res) {
    if (ok) {
      const diff = $.timeDiff(start);

      let base = 'gray';

      // Ns (seconds)
      if (diff.indexOf('ms') === -1) {
        if (parseFloat(diff) > 0.1) {
          base = 'white';
        }

        if (parseFloat(diff) > 0.4) {
          base = 'cyan';
        }

        if (parseFloat(diff) > 1.0) {
          base = 'yellow';
        }

        if (parseFloat(diff) > 2.0) {
          base = 'red';
        }
      }

      const ms = start ? `{${base}|+${diff}}` : '';

      if (err) {
        this.printf('\r\r  {pad.gray|%s} {err.red|%s} %s', type, res || src || dest, ms);
        this.write(err, '\n');
      } else {
        this.printf('\r\r  {pad.gray|%s} {%s|%s} %s\n',
          type, _.TYPES[type] || 'ok.green', res || dest, ms);
      }
    }

    return retval;
  }

  if (!retval || typeof retval.then !== 'function') {
    return end.call(this, retval);
  }

  return retval.then(result => end.call(this, result || dest));
}

module.exports = {
  setLevel(type) {
    if (type === false) {
      current = false;
    } else {
      current = typeof type !== 'number'
        ? _.LEVELS.indexOf(type)
        : type;
    }
    return this;
  },
  setLogger(cb) {
    if (typeof cb === 'boolean' || cb === 0) {
      logger = cb || cb === 0 ? 0 : false;
    } else {
      logger = cb || process.stdout.bind(process);
    }
    return this;
  },
  getLogger(depth, _logger) {
    return status.bind({
      printf: log(0, true, depth, _logger || logger),
      write: log(0, false, depth, _logger || logger),
      info: log(1, null, depth, _logger || logger),
      debug: log(2, null, depth, _logger || logger),
      verbose: log(3, null, depth, _logger || logger),
      isDebug: () => current > 1,
      isEnabled: () => current >= 0,
    });
  },
};
