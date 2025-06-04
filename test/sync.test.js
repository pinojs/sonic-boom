'use strict'

const { test } = require('node:test')
const fs = require('fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file, once } = require('./helper')

test('write buffers that are not totally written with sync mode', async (t) => {
  t.plan(8)

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
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })

  const promise1 = once(stream, 'ready', () => {
    t.assert.ok('ready emitted')
  })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  stream.end()

  const promise2 = once(stream, 'finish', () => {
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\nsomething else\n')
  })

  const promise3 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  await Promise.all([promise1, promise2, promise3])
})

test('write buffers that are not totally written with flush sync', async (t) => {
  t.plan(6)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.write called')
    fakeFs.writeSync = fs.writeSync
    return 0
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 100, sync: false })

  const promise1 = once(stream, 'ready', () => {
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

  const promise2 = once(stream, 'finish', () => {
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\nsomething else\n')
  })

  const promise3 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  await Promise.all([promise1, promise2, promise3])
})

test('sync writing is fully sync', async (t) => {
  t.plan(6)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc, cb) {
    t.assert.ok('fake fs.write called')
    return fs.writeSync(fd, buf, enc)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })
  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  // 'drain' will be only emitted once,
  // the number of assertions at the top check this.
  const promise1 = once(stream, 'drain', () => {
    t.assert.ok('drain emitted')
  })

  const data = fs.readFileSync(dest, 'utf8')
  t.assert.strictEqual(data, 'hello world\nsomething else\n')

  await promise1
})

test('write enormously large buffers sync', async (t) => {
  t.plan(2)

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

  const promise1 = once(stream, 'finish', () => {
    const stat = fs.statSync(dest)
    t.assert.strictEqual(stat.size, length)
  })

  const promise2 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  await Promise.all([promise1, promise2])
})

test('write enormously large buffers sync with utf8 multi-byte split', async (t) => {
  t.plan(3)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })

  let buf = Buffer.alloc((1024 * 16) - 2).fill('x') // 16MB - 3B
  const length = buf.length + 4
  buf = buf.toString() + '🌲' // 16 MB + 1B

  stream.write(buf)

  stream.end()

  const promise1 = once(stream, 'finish', () => {
    const stat = fs.statSync(dest)
    t.assert.strictEqual(stat.size, length)
    const char = Buffer.alloc(4)
    const fd = fs.openSync(dest, 'r')
    fs.readSync(fd, char, 0, 4, length - 4)
    t.assert.strictEqual(char.toString(), '🌲')
  })

  const promise2 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })
  await Promise.all([promise1, promise2])
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
    t.fail('must throw synchronously')
  } catch (err) {
    t.assert.ok('an error happened')
  }
})

for (const fd of [1, 2]) {
  test(`fd ${fd}`, async (t) => {
    t.plan(1)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const stream = new SonicBoom({ fd })

    fakeFs.close = function (fd, cb) {
      t.assert.fail(`should not close fd ${fd}`)
    }

    stream.end()

    await once(stream, 'close', () => {
      t.assert.ok('close emitted')
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

  t.assert.strictEqual(stream._len, 0)

  stream.end()
})

test('._len must always be equal or greater than 0', (t) => {
  const n = 20
  t.plan(n + 2)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: true, minLength: 20 })

  let str = ''
  for (let i = 0; i < 20; i++) {
    t.assert.ok(stream.write('👀'))
    str += '👀'
  }

  t.assert.strictEqual(stream._len, 0)

  const data = fs.readFileSync(dest, 'utf8')
  t.assert.strictEqual(data, str)
})
