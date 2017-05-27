'use strict';

const _ = require('./constants');
const $ = require('./utils');

let stdout;
let stderr;

// disabled
let current = false;

/* eslint-disable prefer-rest-params */
/* eslint-disable prefer-spread */

function log(allowed, format, depth, cb) {
  return function _log() {
    /* istanbul ignore else */
    if (cb && current !== false && allowed <= current) {
      if (format !== null) {
        cb.write(format !== false
          ? $.style(`\r\r${$.puts.apply(null, arguments)}`, depth)
          : $.puts.apply(null, arguments));
      } else {
        cb.write($.style($.puts.apply(null, arguments), depth));
      }
    }

    return this;
  };
}

function status(start, type, out, cb) {
  /* istanbul ignore else */
  if (!(start instanceof Date)) {
    cb = out;
    out = type || {};
    type = start || 'log';
    start = new Date();
  }

  /* istanbul ignore else */
  if (typeof type === 'object') {
    cb = out;
    out = type || {};
    type = out.type || 'unknown';
  }

  let prefix = '';

  /* istanbul ignore else */
  if (type.indexOf(':') > -1) {
    prefix = type.split(':')[0];
    type = type.split(':')[1];
  }

  const ok = this.isEnabled();

  let dest = (out && typeof out === 'object') ? out.dest : out;
  let src = (out && typeof out === 'object') ? out.src : out;

  /* istanbul ignore else */
  if (src) {
    if (Array.isArray(src) && src.length > 1) {
      src = `[${src.length} file${src.length !== 1 ? 's' : ''}]`;
    } else {
      src = (src || '').toString();
    }
  }

  /* istanbul ignore else */
  if (cb && typeof cb !== 'function') {
    throw new Error(`Expected callback, given '${cb}'`);
  }

  src = src || '?';
  dest = dest || src || '?';

  let err;
  let retval;

  try {
    /* istanbul ignore else */
    if (cb) {
      this.printf('\r\r  {pad.gray|%s} {wait.gray|%s ...}\r', prefix || type, src);
      retval = cb();
    }
  } catch (e) {
    err = e;
  }

  function end(res, _error) {
    /* istanbul ignore else */
    if (ok) {
      const diff = $.timeDiff(start);

      let base = 'gray';

      // Ns (seconds)
      /* istanbul ignore else */
      if (diff.indexOf('ms') === -1) {
        /* istanbul ignore else */
        if (parseFloat(diff) > 0.1) {
          base = 'white';
        }

        /* istanbul ignore else */
        if (parseFloat(diff) > 0.4) {
          base = 'cyan';
        }

        /* istanbul ignore else */
        if (parseFloat(diff) > 1.0) {
          base = 'yellow';
        }

        /* istanbul ignore else */
        if (parseFloat(diff) > 2.0) {
          base = 'red';
        }
      }

      const ms = start ? `{${base}|+${diff}}` : '';

      if (err || _error) {
        this.printf('\r\r  {pad.gray|%s} {err|%s} %s\n', prefix || type,
          src || dest,
          ms);

        this.printf('{red|%s}\n', (err || _error));
      } else {
        /* istanbul ignore else */
        if (res && Array.isArray(res)) {
          prefix = (res.length === 3 ? res[0] : null) || prefix;
          type = (res.length === 3 ? res[1] : res[0]) || type;
          dest = (res.length === 3 ? res[2] : res[1]) || dest;
        }

        this.printf('\r\r  {pad.gray|%s} {%s|%s} %s\n',
          prefix || type,
          _.TYPES[type] || 'ok',
          dest,
          ms);
      }
    }

    return retval;
  }

  /* istanbul ignore else */
  if (!retval || typeof retval.then !== 'function') {
    return end.call(this, retval);
  }

  return retval
    .then(result => end.call(this, result || dest))
    .catch(error => end.call(this, dest, error));
}

function makeLogger(depth, _stdout, _stderr) {
  [_stdout || stdout, _stderr || stderr].forEach(stream => {
    /* istanbul ignore else */
    if (stream._handle && stream.isTTY
      && typeof stream._handle.setBlocking === 'function') {
      stream._handle.setBlocking(true);
    }
  });

  const ctx = {
    printf: log(0, true, depth, _stdout || stdout),
    write: log(0, false, depth, _stdout || stdout),
    info: log(1, null, depth, _stdout || stdout),
    debug: log(2, null, depth, _stdout || stdout),
    verbose: log(3, null, depth, _stdout || stdout),
    isInfo: () => current > 0,
    isDebug: () => current > 1,
    isVernose: () => current > 2,
    isEnabled: () => current >= 0,
  };

  const $logger = status.bind(ctx);

  Object.keys(ctx).forEach(key => {
    $logger[key] = ctx[key].bind(ctx);
  });

  return $logger;
}

module.exports = {
  setLevel(type) {
    if (type === false) {
      current = -1;
    } else {
      current = typeof type === 'string'
        ? _.LOG_LEVELS.indexOf(type)
        : type || 0;
    }
    return this;
  },
  setLogger(cb, e) {
    if (typeof cb === 'boolean' || cb === 0) {
      stdout = cb || cb === 0 ? 0 : false;
    } else {
      stdout = cb || process.stdout;
    }
    stderr = e || process.stderr;
    return this;
  },
  getLogger(depth, _stdout, _stderr) {
    return makeLogger(depth, _stdout, _stderr);
  },
};
