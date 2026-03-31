'use strict'

const test = require('node:test')
const fs = require('node:fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file } = require('./helper')

test('write buffers that are not totally written with sync mode', (t, end) => {
  t.plan(9)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.write called')
    fakeFs.writeSync = (fd, buf, enc) => {
      t.assert.ok('calling real fs.writeSync, ' + buf)
      return fs.writeSync(fd, buf, enc)
    }
    return 0
  }
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.assert.ifError(err)
      t.assert.equal(data, 'hello world\nsomething else\n')
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

test('write buffers that are not totally written with flush sync', (t, end) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.write called')
    fakeFs.writeSync = fs.writeSync
    return 0
  }
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 100, sync: false })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  stream.flushSync()

  stream.on('write', (n) => {
    if (n === 0) {
      t.assert.fail('throwing to avoid infinite loop')
      throw Error('shouldn\'t call write handler after flushing with n === 0')
    }
  })

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.assert.ifError(err)
      t.assert.equal(data, 'hello world\nsomething else\n')
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

test('sync writing is fully sync', (t, end) => {
  t.plan(6)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc, cb) {
    t.assert.ok('fake fs.write called')
    return fs.writeSync(fd, buf, enc)
  }
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })
  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  // 'drain' will be only emitted once,
  // the number of assertions at the top check this.
  stream.on('drain', () => {
    t.assert.ok('drain emitted')
    process.nextTick(end)
  })

  const data = fs.readFileSync(dest, 'utf8')
  t.assert.equal(data, 'hello world\nsomething else\n')
})

test('write enormously large buffers sync', (t, end) => {
  t.plan(3)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })

  const buf = Buffer.alloc(1024).fill('x').toString() // 1 MB
  let length = 0

  for (let i = 0; i < 1024 * 512; i++) {
    length += buf.length
    stream.write(buf)
  }

  stream.end()

  stream.on('finish', () => {
    fs.stat(dest, (err, stat) => {
      t.assert.ifError(err)
      t.assert.equal(stat.size, length)
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

test('write enormously large buffers sync with utf8 multi-byte split', (t, end) => {
  t.plan(4)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })

  let buf = Buffer.alloc((1024 * 16) - 2).fill('x') // 16MB - 3B
  const length = buf.length + 4
  buf = buf.toString() + '🌲' // 16 MB + 1B

  stream.write(buf)

  stream.end()

  stream.on('finish', () => {
    fs.stat(dest, (err, stat) => {
      t.assert.ifError(err)
      t.assert.equal(stat.size, length)
      const char = Buffer.alloc(4)
      const fd = fs.openSync(dest, 'r')
      fs.readSync(fd, char, 0, 4, length - 4)
      t.assert.equal(char.toString(), '🌲')
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

// for context see this issue https://github.com/pinojs/pino/issues/871
test('file specified by dest path available immediately when options.sync is true', (t) => {
  t.plan(3)
  const dest = file()
  const stream = new SonicBoom({ dest, sync: true })
  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))
  stream.flushSync()
  t.assert.ok('file opened and written to without error')
})

test('sync error handling', (t) => {
  t.plan(1)
  try {
    /* eslint no-new: off */
    new SonicBoom({ dest: '/path/to/nowwhere', sync: true })
    t.assert.fail('must throw synchronously')
  } catch (err) {
    t.assert.ok('an error happened')
  }
})

for (const fd of [1, 2]) {
  test(`fd ${fd}`, (t, end) => {
    t.plan(1)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    const stream = new SonicBoom({ fd })

    fakeFs.close = function (fd, cb) {
      t.assert.fail(`should not close fd ${fd}`)
    }

    stream.end()

    stream.on('close', () => {
      t.assert.ok('close emitted')
      end()
    })
  })
}

test('._len must always be equal or greater than 0', (t) => {
  t.plan(3)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: true })

  t.assert.ok(stream.write('hello world 👀\n'))
  t.assert.ok(stream.write('another line 👀\n'))

  t.assert.equal(stream._len, 0)

  stream.end()
})

test('._len must always be equal or greater than 0', (t, end) => {
  const n = 20
  t.plan(n + 3)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: true, minLength: 20 })

  let str = ''
  for (let i = 0; i < 20; i++) {
    t.assert.ok(stream.write('👀'))
    str += '👀'
  }

  t.assert.equal(stream._len, 0)

  fs.readFile(dest, 'utf8', (err, data) => {
    t.assert.ifError(err)
    t.assert.equal(data, str)
    end()
  })
})
