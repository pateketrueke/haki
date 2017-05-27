logger = require('../lib/logger')

mock = ->
  (msg...) ->
    mock.buffer ||= []
    mock.buffer.push msg.join('')

describe 'Haki.log', ->
  beforeEach ->
    @log = logger.getLogger(10, mock())

  afterEach ->
    mock.buffer = null

  it 'can print status', (done) ->
    #all sync
    @log()
    @log('ok')
    @log('foo')
    @log('bar', 'buzz')
    @log('fail', 'message')
    @log('write', 'message', -> 42)

    # async
    @log('async', { src: 'input', dest: 'output' }, ->
      new Promise((resolve) ->
        setTimeout ->
          resolve(null)
        , 100
      )
    ).then (x) ->
      expect(mock.buffer.length).toEqual 9
      done()
