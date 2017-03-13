rimraf = require('rimraf')
ttys = require('ttys')
path = require('path')
fs = require('fs')

Haki = require('..')

jasmine.DEFAULT_TIMEOUT_INTERVAL = 45000

fixturesPath = path.join(__dirname, 'fixtures')
generatedPath = path.join(__dirname, '..', 'generated')

readFile = (file) ->
  fs.readFileSync(path.join(generatedPath, file)).toString()

sendLine = (line) ->
  setImmediate ->
    ttys.stdin.emit('data', line)

# hide tty-output
ttys.stdout.write = ->

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

    haki.runGenerator('test').then (result) ->
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

    haki.chooseGeneratorList().then ->
      expect(temp).toEqual 42
      done()

    sendLine '\n'

  it 'can prompt manually', (done) ->
    haki.prompt
      name: 'input'
    .then (value) ->
      expect(value).toEqual 'OK'
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

    haki.runGenerator('test', { x: 'y', m: 'n' }).then (result) ->
      expect(data).toEqual { x: 'y', a: 'b', m: 'n' }
      done()

    sendLine 'b\n'

  it 'will validate actions', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{}]
    ).catch (error) ->
      expect(error.message).toContain "Unsupported 'undefined' action"
      done()

  it 'will fail when destPath is missing', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'add' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid destPath, given 'undefined'"
      done()

  it 'will fail when srcPath is missing', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'copy', destPath: 'a.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid srcPath, given 'undefined'"
      done()

  it 'will fail when pattern is missing', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'modify', destPath: 'a.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid pattern, given 'undefined'"
      done()

  it 'will fail on unsupported prompts', (done) ->
    haki.runGenerator(
      abortOnFail: true
      prompts: [{ type: 'x' }]
    ).catch (error) ->
      expect(error.message).toContain "Unsupported 'x' prompt"
      done()

  it 'will fail on broken actions', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [
        -> throw new Error('FAIL')
      ]
    ).catch (error) ->
      expect(error.message).toContain 'FAIL'
      done()

  it 'will fail on broken prompts', (done) ->
    haki.runGenerator(
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
    haki.runGenerator(
      abortOnFail: true
      basePath: fixturesPath
      actions: [
        { type: 'add', destPath: 'copy.txt', srcPath: 'templates/sample.txt' }
        { type: 'copy', destPath: 'copy.txt', srcPath: 'templates/test.txt' }
      ]
    ).catch (error) ->
      expect(error.message).toMatch /File '.*test\.txt' cannot be copied/
      done()

    sendLine 'x\n'

  it 'will report missing sources', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'copy', srcPath: 'a.txt', destPath: 'b.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Source 'a.txt' does not exists"
      done()

    sendLine 'x\n'

  it 'will report unsupported actions', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'dunno', destPath: 'a.txt' }]
    ).catch (error) ->
      expect(error.message).toContain "Unsupported 'dunno' action"
      done()

    sendLine 'x\n'

  it 'will report when abortOnFail is true', (done) ->
    haki.runGenerator(
      actions: [{ abortOnFail: true, destPath: 'a.txt' }]
    ).then (result) ->
      expect(result.error).toEqual new Error("Unsupported 'undefined' action")
      expect(result.failures).toEqual [new Error("Unsupported 'undefined' action")]
      done()

    sendLine 'x\n'

  it 'will report missing commands', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'exec' }]
    ).catch (error) ->
      expect(error.message).toContain "Invalid command, given 'undefined'"
      done()

  it 'will execute commands', (done) ->
    haki.runGenerator(
      actions: [{ type: 'exec', command: 'echo ok' }]
    ).then (result) ->
      expect(result.changes[0].stdOut).toEqual 'ok\n'
      done()

  it 'will report errors on executing commands', (done) ->
    haki.runGenerator(
      abortOnFail: true
      actions: [{ type: 'exec', command: 'not_defined_cmd' }]
    ).catch (error) ->
      expect(error.message).toMatch /command not found/
      done()

  it 'will install all dependencies', (done) ->
    haki.runGenerator(
      actions: [
        { type: 'add', destPath: 'package.json', template: '''
          {
            "name": "example",
            "dependencies": {
              "noop": "*"
            }
          }
        ''' }
        { type: 'install', destPath: '.' }
      ]
    ).then (result) ->
      expect(readFile('node_modules/noop/package.json')).toContain 'noop@'
      expect(result.changes[1]).toEqual { type: 'install' }
      rimraf.sync path.join(fixturesPath, 'node_modules')
      done()

  it 'will install given dependencies', (done) ->
    haki.runGenerator(
      actions: [
        { type: 'add', destPath: 'package.json', template: '{ "name": "example" }' }
        { type: 'install', dependencies: ['noop'], destPath: '.' }
      ]
    ).then (result) ->
      expect(readFile('node_modules/noop/package.json')).toContain 'noop@'
      expect(result.changes[1]).toEqual { type: 'install', dependencies: ['noop'] }
      rimraf.sync path.join(fixturesPath, 'node_modules')
      done()

  it 'will modify given files', (done) ->
    haki.runGenerator(
      actions: [
        { type: 'add', destPath: 'example.txt', template: 'foo' }
        { type: 'modify', destPath: 'example.txt', pattern: /$/, template: '$&\nbar' }
      ]
    ).then (result) ->
      expect(readFile('example.txt')).toEqual 'foo\nbar'
      expect(result.changes).toEqual [
        { type: 'add', destPath: 'example.txt' }
        { type: 'modify', destPath: 'example.txt' }
      ]
      done()

    sendLine 'y\n'

  it 'will clone given repos', (done) ->
    haki.runGenerator(
      actions: [
        { type: 'clone', destPath: '.', gitUrl: 'githubtraining/example-markdown' }
      ]
    ).then (result) ->
      expect(readFile('README.md')).toContain 'sample-markdown'
      expect(result.changes).toEqual [{ type: 'clone', repository: 'githubtraining/example-markdown' }]
      done()

  it 'will clean given sources', (done) ->
    haki.runGenerator(
      actions: [
        { type: 'add', destPath: 'rm_dir/a.txt', template: 'x' }
        { type: 'add', destPath: 'rm_dir/b.txt', template: 'y' }
        { type: 'clean', destPath: 'rm_dir/a.txt' }
      ]
    ).then (result) ->
      expect(-> readFile('rm_dir/a.txt')).toThrow()
      expect(readFile('rm_dir/b.txt')).toEqual 'y'
      done()
