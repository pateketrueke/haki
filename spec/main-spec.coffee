expect = require('expect')
rimraf = require('rimraf')
ttys = require('ttys')
path = require('path')
fs = require('fs')

Haki = require('..')

fixturesPath = path.join(__dirname, 'fixtures')
generatedPath = path.join(__dirname, '..', 'generated')

readFile = (file) ->
  fs.readFileSync(path.join(generatedPath, file)).toString()

sendLine = (line) ->
  setImmediate ->
    ttys.stdin.emit('data', line)

# hide tty-output
tty_write = ttys.stdout.write

tty_off = ->
  ttys.stdout.write = ->

tty_on = ->
  ttys.stdout.write = tty_write

# TODO:
log = null
haki = null

describe 'Haki', ->
  beforeEach ->
    rimraf.sync generatedPath
    log = []
    haki = new Haki
      quiet: true
      cwd: generatedPath
      stdin: ttys.stdin
      stdout: ttys.stdout
      logger: (line) -> log.push(line)
    # safe wrapper
    haki._runGenerator = (args...) ->
      tty_off()
      haki.runGenerator(args...)
        .catch (error) ->
          tty_on()
          throw error
        .then (result) ->
          tty_on()
          result

  it 'should handle errors', (done) ->
    pass = []

    haki.setGenerator 'test',
      prompts: [{
        name: 'value'
        message: 'Anything:'
        validate: (value) ->
          _value = if value is '42'
            true
          else
            'FAIL'

          # capture passed value
          pass.push([value, _value])

          _value
      }]

    haki._runGenerator('test').then (result) ->
      expect(pass).toEqual [
        ['4', 'FAIL'] # 4
        ['42', true] # 2
        ['42', true] # \n
      ]

      done()

    sendLine '42\n'

  it 'will fail on missing generators', ->
    expect(-> haki.chooseGeneratorList()).toThrow()

  it 'can display generators', (done) ->
    temp = null

    expect(-> haki.setGenerator()).toThrow()

    haki.setGenerator 'test',
      actions: ->
        temp = 42
        []

    tty_off()
    haki.chooseGeneratorList().then ->
      expect(temp).toEqual 42
      tty_on()
      done()

    sendLine '\n'

  it 'can prompt manually', (done) ->
    tty_off()
    haki.prompt
      name: 'input'
    .then (value) ->
      expect(value).toEqual 'OK'
      tty_on()
      done()

    sendLine 'OK\n'

  it 'can load files', ->
    haki.load require.resolve('./fixtures/Hakifile')
    haki.load '../spec/fixtures/Hakifile.js'

    test = haki.getGeneratorList()[0]

    expect(test.name).toEqual 'other'
    expect(test.task.basePath).toEqual fixturesPath
    expect(test.task.description).toEqual 'Another generator test'

  it 'will export getPath()', ->
    expect(haki.getPath()).toEqual generatedPath
    expect(haki.getPath('a/b.c')).toEqual path.join(generatedPath, 'a/b.c')

  it 'will export addHelper()', ->
    pkg = require('../package.json')

    haki.addHelper 'pkg', () ->
      (text) ->
        keys = text.split('.')
        obj = pkg
        obj = obj[keys.shift()] while keys.length
        obj

    expect(haki.getHelperList()).toContain 'pkg'
    expect(haki.renderString('{{pkg name}}')).toEqual 'haki'
    expect(haki.renderString('{{pkg dependencies.chalk}}')).toEqual '^1.1.3'

  it 'will export renderString()', ->
    expect(haki.renderString('{{constantCase a}}', { a: 'b' })).toEqual 'B'
    expect(haki.renderString('{{singularize x}}', { x: 'posts' })).toEqual 'post'
    expect(haki.renderString('{{pluralize x}}', { x: 'post' })).toEqual 'posts'

  it 'will pass all values', (done) ->
    data = null

    haki.setGenerator 'test',
      prompts: [
        { name: 'a' }
        { name: 'm' }
      ]
      actions: -> [(v) -> data = v]

    haki._runGenerator('test', { x: 'y', m: 'n' }).then (result) ->
      expect(data).toEqual { x: 'y', a: 'b', m: 'n' }
      done()

    sendLine 'b\n'

  it 'will validate actions', ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{}]
    ).catch (error) ->
      expect(error.message).toContain "Unsupported 'undefined' action"

  it 'will fail when dest is missing', ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'add' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid dest, given 'undefined'"

  it 'will fail when src is missing', ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'copy', dest: 'a.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid src, given 'undefined'"

  it 'will fail when pattern is missing', ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ modify: 'a.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid pattern, given 'undefined'"

  it 'will fail on unsupported prompts', ->
    haki.runGenerator(
      abortOnFail: true
      prompts: [{ type: 'x' }]
    ).catch (error) ->
      expect(error.message).toContain "Unsupported 'x' prompt"

  it 'will fail on broken actions', ->
    haki.runGenerator(
      abortOnFail: true
      actions: [
        -> throw new Error('FAIL')
      ]
    ).catch (error) ->
      expect(error.message).toContain 'FAIL'

  it 'will fail on broken prompts', (done) ->
    haki._runGenerator(
      abortOnFail: true
      prompts: [{
        name: 'x'
        message: 'Say something:'
        validate: -> throw new Error('FAIL')
      }]
    ).catch (error) ->
      expect(error.message).toContain 'FAIL'
      done()

    sendLine 'y\n'

  it 'will report on copy duplicates', (done) ->
    haki._runGenerator(
      abortOnFail: true
      basePath: fixturesPath
      actions: [
        { add: 'copy.txt', src: 'templates/sample.txt' }
        { copy: 'copy.txt', src: 'templates/test.txt' }
      ]
    ).catch (error) ->
      expect(error.message).toMatch /File '.*test\.txt' cannot be copied/
      done()

    sendLine 'x\n'

  it 'will report missing sources', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'copy', src: 'a.txt', dest: 'b.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Source 'a.txt' does not exists"
      done()

    sendLine 'x\n'

  it 'will report unsupported actions', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'dunno', dest: 'a.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Unsupported 'dunno' action"
      done()

    sendLine 'x\n'

  it 'will report when abortOnFail is true', (done) ->
    haki.runGenerator(
      actions: [{ abortOnFail: true, dest: 'a.txt' }]
    ).then (result) ->
      expect(result.error).toEqual new Error("Unsupported 'undefined' action")
      expect(result.failures).toEqual [new Error("Unsupported 'undefined' action")]
      done()

    sendLine 'x\n'

  it 'will report missing commands', ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'exec' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid command, given 'undefined'"

  it 'will execute commands', ->
    haki.runGenerator(
      actions: [{ exec: 'echo ok' }]
    ).then (result) ->
      expect(result.changes[0].stdOut).toEqual 'ok\n'

  it 'will report errors on executing commands', ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ exec: 'not_defined_cmd' }]
    ).catch (error) ->
      expect(error.message).toMatch /not_defined_cmd.*not found/

  it 'will install all dependencies', ->
    haki.runGenerator(
      actions: [
        { add: 'package.json', content: '''
          {
            "name": "example",
            "dependencies": {
              "noop": "*"
            }
          }
        ''' }
        { type: 'install', dest: '.' }
      ]
    ).then (result) ->
      expect(readFile('node_modules/noop/package.json')).toContain 'noop@'
      expect(result.changes[1]).toEqual { type: 'install' }
      rimraf.sync path.join(fixturesPath, 'node_modules')

  it 'will install given dependencies', ->
    haki.runGenerator(
      actions: [
        { add: 'package.json', content: '{ "name": "example" }' }
        { install: ['noop'], dest: '.' }
      ]
    ).then (result) ->
      expect(readFile('node_modules/noop/package.json')).toContain 'noop@'
      expect(result.changes[1]).toEqual { type: 'install', dependencies: ['noop'] }
      rimraf.sync path.join(fixturesPath, 'node_modules')

  it 'will modify given files', (done) ->
    haki._runGenerator(
      actions: [
        { add: 'example.txt', content: 'foo' }
        { modify: 'example.txt', pattern: /$/, content: '$&\nbar' }
      ]
    ).then (result) ->
      expect(readFile('example.txt')).toEqual 'foo\nbar'
      expect(result.changes).toEqual [
        { type: 'add', dest: 'example.txt' }
        { type: 'modify', dest: 'example.txt' }
      ]
      done()

    sendLine 'y\n'

  it 'will clone given repos', ->
    haki.runGenerator(
      actions: [
        { dest: '.', clone: 'githubtraining/example-markdown' }
      ]
    ).then (result) ->
      expect(readFile('README.md')).toContain 'sample-markdown'
      expect(result.changes).toEqual [{ type: 'clone', repository: 'githubtraining/example-markdown' }]

  it 'will clean given sources', ->
    haki.runGenerator(
      actions: [
        { add: 'rm_dir/a.txt', content: 'x' }
        { add: 'rm_dir/b.txt', content: 'y' }
        { clean: 'rm_dir/a.txt' }
      ]
    ).then (result) ->
      expect(-> readFile('rm_dir/a.txt')).toThrow()
      expect(readFile('rm_dir/b.txt')).toEqual 'y'

  it 'will validate given input', ->
    haki.runGenerator({
      validate:
        sample: (x) -> x is 'yes' or 'nope'
      actions: [{
        exec: 'echo ok'
      }]
    }, { sample: 'x' }).catch (error) ->
      expect(error).toEqual new Error('nope')

  it 'will set default validators', (done) ->
    test = null

    haki._runGenerator({
      validate:
        sample: (x) ->
          test = x
          x is 'yes' or 'nope'
      prompts: [{
        name: 'sample'
      }]
    }).then (result) ->
      expect(test).toEqual 'yes'
      done()

    sendLine 'yes\n'
