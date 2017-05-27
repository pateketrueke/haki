logger = require('../lib/logger')

strip = (str) ->
  str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g, '')

mock = ->
  mock.buffer = []

  (msg...) ->
    mock.buffer.push strip(msg.join(''))

describe 'Haki.log', ->
  beforeEach ->
    @log = logger.getLogger(10, mock())


  it 'can print status', (done) ->
    #all sync
    logger.setLevel(1)
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

  it 'can handle levels', ->
    logger.setLevel(false)
    @log.write(1)

    expect(mock.buffer).toEqual []

    # enable
    logger.setLevel(0)
    @log.write(1)
    @log.printf(2)
    @log.verbose(-1)

    expect(mock.buffer).toEqual ['1', '\r2']

    # info-level
    logger.setLevel(1)
    @log.info(3)
    @log.verbose(-1)

    expect(mock.buffer).toEqual ['1', '\r2', '3']

    # debug-level
    logger.setLevel(2)
    @log.debug(4)
    @log.verbose(-1)

    expect(mock.buffer).toEqual ['1', '\r2', '3', '4']

    # verbose-level
    logger.setLevel(3)
    @log.verbose(5)

    expect(mock.buffer).toEqual ['1', '\r2', '3', '4', '5']
