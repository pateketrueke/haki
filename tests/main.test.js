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
const send = values => {
  if (Array.isArray(values)) {
    haki.getPrompts().inject(values);
  } else {
    haki.getPrompts().override(values);
  }
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

  describe('prompt', () => {
    it('can prompt manually', async () => {
      send(['OK']);

      const value = await haki.prompt({ name: 'test' });

      expect(value).to.eql({ test: 'OK' });
    });
  });

  describe('prompts', () => {
    it('will fail on missing generators', () => {
      expect(() => haki.chooseGeneratorList()).to.throw('here are no registered generators');
    });

    it('can validate given generators (if any)', async () => {
      expect(() => haki.setGenerator()).to.throw(/Generator name must be a string, given .*/);

      haki.setGenerator('test');

      let error;

      try {
        await haki.runGenerator('undef');
      } catch (e) {
        error = e;
      }

      expect(error).to.match(/The 'undef' generator does not exists/);
    });

    it('should prompt from tasks', async () => {
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

      send(['42']);

      const { values } = await run('test');

      expect(values).to.eql({ value: '42' });
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

      send({ a: 'c', b: 'd' });

      await run('test', { x: 'y', m: 'n' });

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

    expect(test.name).to.eql('other');
    expect(test.message).to.eql('Another generator test');
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
    expect(haki.renderString('{{pkg dependencies.chalk}}')).to.eql('^4.1.0');
  });

  it('will export renderString()', () => {
    expect(haki.renderString('{{constantCase a}}', { a: 'b' })).to.eql('B');
    expect(haki.renderString('{{singularize x}}', { x: 'posts' })).to.eql('post');
    expect(haki.renderString('{{pluralize x}}', { x: 'post' })).to.eql('posts');
  });

  it('will modify given files', async () => {
    await haki.runGenerator({
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

    const result = await haki.runGenerator({
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

  it('will render given sources', async () => {
    send(['1', 'FOO', 'BAR', '', '1', '!', '']);

    await haki.runGenerator({
      actions: [{
        add: 'foo.txt',
        content: '{{value}}',
      }, {
        add: 'bar.txt',
        content: '{{#flag}}{{foo}}{{bar}}{{/flag}}{{#a}}{{b}}{{/a}}',
      }, {
        render: 'bar.txt',
      }],
    }).then(result => {
      expect(readFile('foo.txt')).to.eql('{{value}}');
      expect(readFile('bar.txt')).to.eql('FOOBAR!');
      expect(result.changes).to.eql([
        { type: 'add', dest: 'foo.txt' },
        { type: 'add', dest: 'bar.txt' },
      ]);
    });
  });

  describe('generators', () => {
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
        expect(error.message).to.contain('prompt type (x) is not defined');
      });
    });

    it('will fail on broken actions', async () => {
      await haki.runGenerator({
        abortOnFail: true,
        actions() {
          throw new Error('FAIL');
        },
      }).then(shallFail).catch(error => {
        expect(error.message).to.contain('FAIL');
      });
    });

    it('will report unsupported actions', async () => {
      await haki.runGenerator({
        abortOnFail: true,
        actions: [{ type: 'dunno', dest: 'a.txt' }],
      }).then(shallFail).catch(error => {
        expect(error.message).to.contain("Unsupported 'dunno' action");
      });
    });

    it('will report when abortOnFail is true', async () => {
      await haki.runGenerator({
        abortOnFail: false,
        actions: [{ abortOnFail: true, dest: 'a.txt' }],
      }).then(result => {
        expect(result.error.message).to.match(/Unsupported '.*?' action/);
        expect(result.failures[0]).to.match(/Unsupported '.*?' action/);
      });
    });
  });

  describe('actions', () => {
    // FIXME: somehow is not failing...
    it.skip('will clean given sources', async () => {
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

    it('will report on copy duplicates', async () => {
      send(['abort']);

      await haki.runGenerator({
        abortOnFail: true,
        basePath: fixturesPath,
        actions: [
          { add: 'dest/test.txt', templateFile: 'templates/sample.txt' },
          { copy: 'dest', src: 'templates/test.txt' },
        ],
      }).then(shallFail).catch(error => {
        expect(error.message).to.match(/Source '.*test\.txt' won't be copied/);
      });
    });

    // FIXME: somehow is not failing...
    it.skip('will report missing sources', async () => {
      await haki.runGenerator({
        abortOnFail: true,
        actions: [{ type: 'copy', src: 'a.txt', dest: 'b.txt' }],
      }).then(shallFail).catch(error => {
        expect(error.message).to.contain("Source 'a.txt' does not exists");
      });
    });

    it('will clone given repos', async () => {
      send(['My Example', 'y', 'OSOMS', '', 42]);

      await haki.runGenerator({
        actions: [
          { dest: '.', clone: 'pateketrueke/empty' },
        ],
      }).then(result => {
        expect(readFile('README.md')).to.eql('# Empty\n42\n');
        expect(readFile('my_example.md')).to.eql('# My Example\n\n## Osoms\n');
        expect(result.changes).to.eql([{ type: 'clone', repository: 'pateketrueke/empty' }]);
      });
    });

    it('will install all dependencies', async () => {
      const result = await haki.runGenerator({
        actions: [
          {
            add: 'package.json',
            content: '{ "name": "example", "dependencies": { "noop": "*" } }',
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
  });
});
