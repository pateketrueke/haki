const { expect } = require('chai');
const rimraf = require('rimraf');
const ttys = require('ttys');
const path = require('path');
const fs = require('fs');

const Haki = require('..');

const fixturesPath = path.join(__dirname, 'fixtures');
const generatedPath = path.join(__dirname, '..', 'generated');

const readFile = file => fs.readFileSync(path.join(generatedPath, file)).toString();
const sendLine = line => setImmediate(() => ttys.stdin.emit('data', line));
const shallFail = () => { throw new Error('It should not happen!'); };

// hide tty-output
const ttyWrite = ttys.stdout.write;

const ttyOff = () => {
  ttys.stdout.write = () => {};
};

const ttyOn = () => {
  ttys.stdout.write = ttyWrite;
};

// TODO:
let haki = null;

/* global beforeEach, afterEach, describe, it */

describe('Haki', () => {
  beforeEach(() => {
    rimraf.sync(generatedPath);

    haki = new Haki({
      log: false,
      cwd: generatedPath,
      stdin: ttys.stdin,
      stdout: ttys.stdout,
    });

    // safe wrapper
    haki._runGenerator = (...args) => {
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
  });

  afterEach(() => {
    Haki.closeAll();
  });

  it('should handle errors', done => {
    const pass = [];

    haki.setGenerator('test', {
      prompts: [{
        name: 'value',
        message: 'Anything:',
        validate: value => {
          const _value = value === '42' ? true : 'FAIL';

          // capture passed value
          pass.push([value, _value]);

          return _value;
        },
      }],
    });

    haki._runGenerator('test').then(() => {
      expect(pass).to.eql([
        ['4', 'FAIL'], // 4
        ['42', true], // 2
        ['42', true], // \n
      ]);

      done();
    });

    sendLine('42\n');
  });

  it('will fail on missing generators', () => {
    expect(() => haki.chooseGeneratorList()).to.throw();
  });

  it('can display generators', async () => {
    let temp = null;

    expect(() => haki.setGenerator()).to.throw();

    haki.setGenerator('test', {
      actions: () => {
        temp = 42;
        return [];
      },
    });

    ttyOff();
    sendLine('\n');
    await haki.chooseGeneratorList();
    expect(temp).to.eql(42);
    ttyOn();
  });

  it('can prompt manually', async () => {
    ttyOff();
    sendLine('OK\n');

    const value = await haki.prompt({ name: 'input' });

    expect(value).to.eql('OK');
    ttyOn();
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

  it('will pass all values', async () => {
    let data = null;

    haki.setGenerator('test', {
      prompts: [
        { name: 'a' },
        { name: 'm' },
      ],
      actions: () => [v => { data = v; }],
    });

    sendLine('b\n');
    await haki._runGenerator('test', { x: 'y', m: 'n' });
    expect(data).to.eql({ x: 'y', a: 'b', m: 'n' });
  });

  it('will validate actions', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{}],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Unsupported '{}' action");
    });
  });

  it('will fail when dest is missing', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{ type: 'add' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Invalid dest, given 'undefined'");
    });
  });

  it('will fail when src is missing', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{ type: 'copy', dest: 'a.txt' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Invalid src, given 'undefined'");
    });
  });

  it('will fail when pattern is missing', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{ modify: 'a.txt' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Invalid pattern, given 'undefined'");
    });
  });

  it('will fail on unsupported prompts', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      prompts: [{ type: 'x' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Unsupported 'x' prompt");
    });
  });

  it('will fail on broken actions', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      actions: [
        () => { throw new Error('FAIL'); },
      ],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain('FAIL');
    });
  });

  it('will fail on broken prompts', async () => {
    sendLine('y\n');
    await haki._runGenerator({
      abortOnFail: true,
      prompts: [{
        name: 'x',
        message: 'Say something:',
        validate: () => { throw new Error('FAIL'); },
      }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain('FAIL');
    });
  });

  it('will report on copy duplicates', async () => {
    sendLine('x\n');
    await haki._runGenerator({
      abortOnFail: true,
      basePath: fixturesPath,
      actions: [
        { add: 'copy.txt', src: 'templates/sample.txt' },
        { copy: 'copy.txt', src: 'templates/test.txt' },
      ],
    }).then(shallFail).catch(error => {
      expect(error.message).to.match(/Source '.*test\.txt' cannot be copied/);
    });
  });

  it('will report missing sources', async () => {
    sendLine('x\n');
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{ type: 'copy', src: 'a.txt', dest: 'b.txt' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Source 'a.txt' does not exists");
    });
  });

  it('will report unsupported actions', async () => {
    sendLine('x\n');
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{ type: 'dunno', dest: 'a.txt' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Unsupported 'dunno' action");
    });
  });

  it('will report when abortOnFail is true', async () => {
    sendLine('x\n');
    await haki.runGenerator({
      abortOnFail: false,
      actions: [{ abortOnFail: true, dest: 'a.txt' }],
    }).then(result => {
      expect(result.error.message).to.match(/Unsupported '.*?' action/);
      expect(result.failures[0]).to.match(/Unsupported '.*?' action/);
    });
  });

  it('will report missing commands', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{ type: 'exec' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.contain("Invalid command, given 'undefined'");
    });
  });

  it('will execute commands', async () => {
    await haki.runGenerator({
      actions: [{ exec: 'echo ok' }],
    }).then(result => {
      expect(result.changes[0].stdOut).to.eql('ok\n');
    });
  });

  it('will report errors on executing commands', async () => {
    await haki.runGenerator({
      abortOnFail: true,
      actions: [{ exec: 'not_defined_cmd' }],
    }).then(shallFail).catch(error => {
      expect(error.message).to.match(/not_defined_cmd.*not found/);
    });
  });

  it('will install all dependencies', async () => {
    const result = await haki.runGenerator({
      actions: [
        {
          add: 'package.json',
          content: `
            {
              "name": "example",
              "dependencies": {
                "noop": "*"
              }
            }
          `,
        },
        { install: [], dest: '.' },
      ],
    });

    expect(readFile('node_modules/noop/package.json')).to.match(/"noop(?:@.+?)?"/);
    expect(result.changes[1]).to.eql({ type: 'install', dependencies: [] });

    rimraf.sync(path.join(fixturesPath, 'node_modules'));
  }).timeout(10000);

  it('will install given dependencies', async () => {
    await haki.runGenerator({
      actions: [
        { add: 'package.json', content: '{ "name": "example" }' },
        { install: ['noop'], dest: '.' },
      ],
    }).then(result => {
      expect(readFile('node_modules/noop/package.json')).to.match(/"noop(?:@.+?)?"/);
      expect(result.changes[1]).to.eql({ type: 'install', dependencies: ['noop'] });
      rimraf.sync(path.join(fixturesPath, 'node_modules'));
    });
  }).timeout(10000);

  it('will modify given files', async () => {
    sendLine('y\n');
    await haki._runGenerator({
      actions: [
        { add: 'example.txt', content: 'foo' },
        { modify: 'example.txt', pattern: /$/, content: '$&\nbar' },
      ],
    }).then(result => {
      expect(readFile('example.txt')).to.eql('foo\nbar');
      expect(result.changes).to.eql([
        { type: 'add', dest: 'example.txt' },
        { type: 'modify', dest: 'example.txt' },
      ]);
    });
  });

  it('will extend json objects', async () => {
    let test = null;

    sendLine('y\n');

    const result = await haki._runGenerator({
      actions: [
        { add: 'example.json', content: '{"foo":"bar"}' },
        {
          extend: 'example.json',
          callback: data => {
            data.baz = 'buzz';
            test = data;
          },
        },
      ],
    });

    expect(readFile('example.json')).to.contain('{\n  "foo": "bar",\n  "baz": "buzz"\n}');

    expect(result.changes).to.eql([
      { type: 'add', dest: 'example.json' },
      { type: 'extend', dest: 'example.json' },
    ]);

    expect(test).to.eql({
      foo: 'bar',
      baz: 'buzz',
    });
  });

  it('will clone given repos', async () => {
    await haki.runGenerator({
      actions: [
        { dest: '.', clone: 'pateketrueke/empty' },
      ],
    }).then(result => {
      expect(readFile('README.md')).to.contain('# Empty');
      expect(result.changes).to.eql([{ type: 'clone', repository: 'pateketrueke/empty' }]);
    });
  });

  it('will clean given sources', async () => {
    await haki.runGenerator({
      actions: [
        { add: 'rm_dir/a.txt', content: 'x' },
        { add: 'rm_dir/b.txt', content: 'y' },
        { clean: 'rm_dir/a.txt' },
      ],
    });

    expect(() => readFile('rm_dir/a.txt')).to.throw();
    expect(readFile('rm_dir/b.txt')).to.eql('y');
  });

  it('will validate given input', async () => {
    await haki.runGenerator({
      validate: {
        sample: x => (x === 'yes' || 'nope'),
      },
      actions: [{
        exec: 'echo ok',
      }],
    }, { sample: 'x' }).catch(error => {
      expect(error.message).to.eql('nope');
    });
  });

  it('will set default validators', async () => {
    let test = null;

    sendLine('yes\n');

    await haki._runGenerator({
      validate: {
        sample: x => {
          test = x;
          return x === 'yes' || 'nope';
        },
      },
      prompts: [{
        name: 'sample',
      }],
    });

    expect(test).to.eql('yes');
  });

  it('will render given sources', async () => {
    await haki.runGenerator({
      actions: [{
        add: 'foo.txt',
        content: '{{value}}',
      }, {
        add: 'bar.txt',
        content: '{{value}}',
      }, {
        render: 'bar.txt',
      }],
    }, {
      value: 'foo',
    }).then(result => {
      expect(readFile('foo.txt')).to.eql('{{value}}');
      expect(readFile('bar.txt')).to.eql('foo');
      expect(result.changes).to.eql([
        { type: 'add', dest: 'foo.txt' },
        { type: 'add', dest: 'bar.txt' },
      ]);
    });
  });
});
