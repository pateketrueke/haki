const { expect } = require('chai');
const rimraf = require('rimraf');
const ttys = require('ttys');
const path = require('path');
const fs = require('fs');

const Haki = require('..');

const fixturesPath = path.join(__dirname, 'fixtures');
const generatedPath = path.join(__dirname, '..', 'generated');

const readFile = file => fs.readFileSync(path.join(generatedPath, file)).toString();
const shallFail = () => { throw new Error('It should not happen!'); };

// hide tty-output
const ttyWrite = ttys.stdout.write;

const ttyOff = () => {
  ttys.stdout.write = () => {};
};

const ttyOn = () => {
  ttys.stdout.write = ttyWrite;
};

let haki;

// safe wrappers
const send = (...values) => {
  const enquirer = haki.getEnquirer();

  if (typeof values[0] === 'function') {
    enquirer.on('prompt', values[0]);

    return () => {
      enquirer.off('prompt', values[0]);
    };
  }

  values.forEach(value => {
    const mock = p => {
      enquirer.off('prompt', mock);
      p.value = value;
      p.submit();
    };

    enquirer.on('prompt', mock);
  });
};

const run = (...args) => {
  ttyOff();

  return haki.runGenerator(...args)
    .catch(error => {
      ttyOn();
      throw error;
    })
    .then(result => {
      ttyOn();
      return result;
    });
};

/* global beforeEach, describe, it */

describe('Haki', () => {
  beforeEach(() => {
    rimraf.sync(generatedPath);

    haki = new Haki({
      log: false,
      cwd: generatedPath,
      stdin: ttys.stdin,
      stdout: ttys.stdout,
    });
  });

  describe('prompts', () => {
    it('should validate input', async () => {
      const pass = [];

      haki.setGenerator('test', {
        prompts: [{
          name: 'value',
          validate: value => {
            const _value = value === '42' ? true : 'FAIL';

            // capture passed value
            pass.push([value, _value]);

            return _value;
          },
        }],
      });

      send('x', '42');

      const { values } = await run('test');

      expect(pass).to.eql([
        ['x', 'FAIL'],
        ['42', true],
      ]);

      expect(values).to.eql({ value: '42' });
    });

    it('will fail on missing generators', () => {
      expect(() => haki.chooseGeneratorList()).to.throw('here are no registered generators');
    });

    it('can validate given generators (if any)', async () => {
      expect(() => haki.setGenerator()).to.throw(/Generator name must be a string, given .*/);

      haki.setGenerator('test');

      let error;

      send('undef');

      try {
        await haki.chooseGeneratorList();
      } catch (e) {
        error = e;
      }

      expect(error).to.match(/The 'undef' generator does not exists/);
    });

    it('can prompt manually', async () => {
      send('OK');

      const value = await haki.prompt({ name: 'test' });

      expect(value).to.eql({ test: 'OK' });
    });

    it('will pass all values', async () => {
      let data = null;

      haki.setGenerator('test', {
        prompts: [
          { name: 'a' },
          { name: 'b' },
        ],
        actions: () => [v => { data = v; }],
      });

      const off = send(p => {
        if (p.name === 'a') p.value = 'c';
        if (p.name === 'b') p.value = 'd';
        p.submit();
      });

      await run('test', { x: 'y', m: 'n' });

      off();
      expect(data).to.eql({
        x: 'y',
        a: 'c',
        b: 'd',
        m: 'n',
      });
    });
  });

  it('can load files', () => {
    haki.load(require.resolve('./fixtures/Hakifile'));
    haki.load('../tests/fixtures/Hakifile.js');

    const test = haki.getGeneratorList()[0];

    expect(test.gen).to.eql('other');
    expect(test.name).to.eql('Another generator test');
    expect(test.value.basePath).to.eql(fixturesPath);
    expect(test.value.description).to.eql('Another generator test');
  });

  it('will export getPath()', () => {
    expect(haki.getPath()).to.eql(generatedPath);
    expect(haki.getPath('a/b.c')).to.eql(path.join(generatedPath, 'a/b.c'));
  });

  it('will export addHelper()', () => {
    const pkg = require('../package.json');

    haki.addHelper('pkg', text => {
      const keys = text.split('.');
      let obj = pkg;
      while (keys.length) {
        obj = obj[keys.shift()];
      }
      return obj;
    });

    expect(haki.getHelperList()).to.contain('pkg');
    expect(haki.renderString('{{pkg name}}')).to.eql('haki');
    expect(haki.renderString('{{pkg dependencies.chalk}}')).to.eql('^2.3.0');
  });

  it('will export renderString()', () => {
    expect(haki.renderString('{{constantCase a}}', { a: 'b' })).to.eql('B');
    expect(haki.renderString('{{singularize x}}', { x: 'posts' })).to.eql('post');
    expect(haki.renderString('{{pluralize x}}', { x: 'post' })).to.eql('posts');
  });

  // it('will validate actions', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{}],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Unsupported '{}' action");
  //   });
  // });

  // it('will fail when dest is missing', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{ type: 'add' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Invalid dest, given 'undefined'");
  //   });
  // });

  // it('will fail when src is missing', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{ type: 'copy', dest: 'a.txt' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Invalid src, given 'undefined'");
  //   });
  // });

  // it('will fail when pattern is missing', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{ modify: 'a.txt' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Invalid pattern, given 'undefined'");
  //   });
  // });

  // it('will fail on unsupported prompts', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     prompts: [{ type: 'x' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Unsupported 'x' prompt");
  //   });
  // });

  // it('will fail on broken actions', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [
  //       () => { throw new Error('FAIL'); },
  //     ],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain('FAIL');
  //   });
  // });

  // it('will fail on broken prompts', async () => {
  //   sendLine('y\n');
  //   await haki._runGenerator({
  //     abortOnFail: true,
  //     prompts: [{
  //       name: 'x',
  //       message: 'Say something:',
  //       validate: () => { throw new Error('FAIL'); },
  //     }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain('FAIL');
  //   });
  // });

  // it('will report on copy duplicates', async () => {
  //   sendLine('x\n');
  //   await haki._runGenerator({
  //     abortOnFail: true,
  //     basePath: fixturesPath,
  //     actions: [
  //       { add: 'copy.txt', src: 'templates/sample.txt' },
  //       { copy: 'copy.txt', src: 'templates/test.txt' },
  //     ],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.match(/Source '.*test\.txt' cannot be copied/);
  //   });
  // });

  // it('will report missing sources', async () => {
  //   sendLine('x\n');
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{ type: 'copy', src: 'a.txt', dest: 'b.txt' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Source 'a.txt' does not exists");
  //   });
  // });

  // it('will report unsupported actions', async () => {
  //   sendLine('x\n');
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{ type: 'dunno', dest: 'a.txt' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Unsupported 'dunno' action");
  //   });
  // });

  // it('will report when abortOnFail is true', async () => {
  //   sendLine('x\n');
  //   await haki.runGenerator({
  //     abortOnFail: false,
  //     actions: [{ abortOnFail: true, dest: 'a.txt' }],
  //   }).then(result => {
  //     expect(result.error.message).to.match(/Unsupported '.*?' action/);
  //     expect(result.failures[0]).to.match(/Unsupported '.*?' action/);
  //   });
  // });

  // it('will report missing commands', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{ type: 'exec' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.contain("Invalid command, given 'undefined'");
  //   });
  // });

  // it('will execute commands', async () => {
  //   await haki.runGenerator({
  //     actions: [{ exec: 'echo ok' }],
  //   }).then(result => {
  //     expect(result.changes[0].stdOut).to.eql('ok\n');
  //   });
  // });

  // it('will report errors on executing commands', async () => {
  //   await haki.runGenerator({
  //     abortOnFail: true,
  //     actions: [{ exec: 'not_defined_cmd' }],
  //   }).then(shallFail).catch(error => {
  //     expect(error.message).to.match(/not_defined_cmd.*not found/);
  //   });
  // });

  // it('will install all dependencies', async () => {
  //   const result = await haki.runGenerator({
  //     actions: [
  //       {
  //         add: 'package.json',
  //         content: `
  //           {
  //             "name": "example",
  //             "dependencies": {
  //               "noop": "*"
  //             }
  //           }
  //         `,
  //       },
  //       { install: [], dest: '.' },
  //     ],
  //   });

  //   expect(readFile('node_modules/noop/package.json')).to.match(/"noop(?:@.+?)?"/);
  //   expect(result.changes[1]).to.eql({ type: 'install', dependencies: [] });

  //   rimraf.sync(path.join(fixturesPath, 'node_modules'));
  // }).timeout(10000);

  // it('will install given dependencies', async () => {
  //   await haki.runGenerator({
  //     actions: [
  //       { add: 'package.json', content: '{ "name": "example" }' },
  //       { install: ['noop'], dest: '.' },
  //     ],
  //   }).then(result => {
  //     expect(readFile('node_modules/noop/package.json')).to.match(/"noop(?:@.+?)?"/);
  //     expect(result.changes[1]).to.eql({ type: 'install', dependencies: ['noop'] });
  //     rimraf.sync(path.join(fixturesPath, 'node_modules'));
  //   });
  // }).timeout(10000);

  // it('will modify given files', async () => {
  //   sendLine('y\n');
  //   await haki._runGenerator({
  //     actions: [
  //       { add: 'example.txt', content: 'foo' },
  //       { modify: 'example.txt', pattern: /$/, content: '$&\nbar' },
  //     ],
  //   }).then(result => {
  //     expect(readFile('example.txt')).to.eql('foo\nbar');
  //     expect(result.changes).to.eql([
  //       { type: 'add', dest: 'example.txt' },
  //       { type: 'modify', dest: 'example.txt' },
  //     ]);
  //   });
  // });

  // it('will extend json objects', async () => {
  //   let test = null;

  //   sendLine('y\n');

  //   const result = await haki._runGenerator({
  //     actions: [
  //       { add: 'example.json', content: '{"foo":"bar"}' },
  //       {
  //         extend: 'example.json',
  //         callback: data => {
  //           data.baz = 'buzz';
  //           test = data;
  //         },
  //       },
  //     ],
  //   });

  //   expect(readFile('example.json')).to.contain('{\n  "foo": "bar",\n  "baz": "buzz"\n}');

  //   expect(result.changes).to.eql([
  //     { type: 'add', dest: 'example.json' },
  //     { type: 'extend', dest: 'example.json' },
  //   ]);

  //   expect(test).to.eql({
  //     foo: 'bar',
  //     baz: 'buzz',
  //   });
  // });

  // it('will clone given repos', async () => {
  //   await haki.runGenerator({
  //     actions: [
  //       { dest: '.', clone: 'pateketrueke/empty' },
  //     ],
  //   }).then(result => {
  //     expect(readFile('README.md')).to.contain('# Empty');
  //     expect(result.changes).to.eql([{ type: 'clone', repository: 'pateketrueke/empty' }]);
  //   });
  // });

  // it('will clean given sources', async () => {
  //   await haki.runGenerator({
  //     actions: [
  //       { add: 'rm_dir/a.txt', content: 'x' },
  //       { add: 'rm_dir/b.txt', content: 'y' },
  //       { clean: 'rm_dir/a.txt' },
  //     ],
  //   });

  //   expect(() => readFile('rm_dir/a.txt')).to.throw();
  //   expect(readFile('rm_dir/b.txt')).to.eql('y');
  // });

  // it('will validate given input', async () => {
  //   await haki.runGenerator({
  //     validate: {
  //       sample: x => (x === 'yes' || 'nope'),
  //     },
  //     actions: [{
  //       exec: 'echo ok',
  //     }],
  //   }, { sample: 'x' }).catch(error => {
  //     expect(error.message).to.eql('nope');
  //   });
  // });

  // it('will set default validators', async () => {
  //   let test = null;

  //   sendLine('yes\n');

  //   await haki._runGenerator({
  //     validate: {
  //       sample: x => {
  //         test = x;
  //         return x === 'yes' || 'nope';
  //       },
  //     },
  //     prompts: [{
  //       name: 'sample',
  //     }],
  //   });

  //   expect(test).to.eql('yes');
  // });

  // it('will render given sources', async () => {
  //   await haki.runGenerator({
  //     actions: [{
  //       add: 'foo.txt',
  //       content: '{{value}}',
  //     }, {
  //       add: 'bar.txt',
  //       content: '{{value}}',
  //     }, {
  //       render: 'bar.txt',
  //     }],
  //   }, {
  //     value: 'foo',
  //   }).then(result => {
  //     expect(readFile('foo.txt')).to.eql('{{value}}');
  //     expect(readFile('bar.txt')).to.eql('foo');
  //     expect(result.changes).to.eql([
  //       { type: 'add', dest: 'foo.txt' },
  //       { type: 'add', dest: 'bar.txt' },
  //     ]);
  //   });
  // });
});
