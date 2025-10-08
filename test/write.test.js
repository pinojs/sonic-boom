'use strict'

const { test } = require('node:test')
const fs = require('fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file, runTests, once } = require('./helper')
const { setTimeout: setTimeoutP } = require('timers/promises')
const { on } = require('events')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('write things to a file descriptor', async (t) => {
    t.plan(5)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })

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

  test('write things in a streaming fashion', async (t) => {
    t.plan(8)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })

    const promise1 = new Promise((resolve) => {
      stream.once('drain', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.strictEqual(data, 'hello world\n')
          t.assert.ok(stream.write('something else\n'))
        })

        stream.once('drain', () => {
          fs.readFile(dest, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.strictEqual(data, 'hello world\nsomething else\n')
            stream.end()
            resolve()
          })
        })
      })
    })

    t.assert.ok(stream.write('hello world\n'))

    const promise2 = once(stream, 'finish', () => {
      t.assert.ok('finish emitted')
    })

    const promise3 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })

    await Promise.all([promise1, promise2, promise3])
  })

  test('can be piped into', async (t) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })
    const source = fs.createReadStream(__filename, { encoding: 'utf8' })

    source.pipe(stream)

    const promise1 = new Promise((resolve) => {
      stream.on('finish', () => {
        fs.readFile(__filename, 'utf8', (err, expected) => {
          t.assert.ifError(err)
          fs.readFile(dest, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.strictEqual(data, expected)
            resolve()
          })
        })
      })
    })
    const promise2 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })
    await Promise.all([promise1, promise2])
  })

  test('write things to a file', async (t) => {
    t.plan(6)

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.end()

    const promise2 = new Promise((resolve) => {
      stream.on('finish', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.strictEqual(data, 'hello world\nsomething else\n')
          resolve()
        })
      })
    })

    const promise3 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })
    await Promise.all([promise1, promise2, promise3])
  })

  test('minLength', async (t) => {
    t.plan(8)

    const dest = file()
    const stream = new SonicBoom({ dest, minLength: 4096, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.on('drain', t.assert.fail)

    // bad use of timer
    // TODO refactor
    await setTimeoutP(100)
    const promise2 = new Promise((resolve) => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.strictEqual(data, '')

        stream.end()

        stream.on('finish', () => {
          fs.readFile(dest, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.strictEqual(data, 'hello world\nsomething else\n')
            resolve()
          })
        })
      })
    })

    const promise3 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })

    await Promise.all([promise1, promise2, promise3])
  })

  test('write later on recoverable error', async (t) => {
    t.plan(8)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    const promise2 = once(stream, 'error', () => {
      t.assert.ok('error emitted')
    })

    if (sync) {
      fakeFs.writeSync = function (fd, buf, enc) {
        t.assert.ok('fake fs.writeSync called')
        throw new Error('recoverable error')
      }
    } else {
      fakeFs.write = function (fd, buf, ...args) {
        t.assert.ok('fake fs.write called')
        setTimeout(() => args.pop()(new Error('recoverable error')), 0)
      }
    }

    t.assert.ok(stream.write('hello world\n'))

    await setTimeoutP(0)

    if (sync) {
      fakeFs.writeSync = fs.writeSync
    } else {
      fakeFs.write = fs.write
    }

    t.assert.ok(stream.write('something else\n'))

    stream.end()
    const promise3 = new Promise((resolve) => {
      stream.on('finish', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.strictEqual(data, 'hello world\nsomething else\n')
          resolve()
        })
      })
    })

    const promise4 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })
    await Promise.all([promise1, promise2, promise3, promise4])
  })

  test('emit write events', async (t) => {
    t.plan(7)

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    let length = 0
    stream.on('write', (bytes) => {
      length += bytes
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.end()

    const promise2 = new Promise((resolve) => {
      stream.on('finish', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.strictEqual(data, 'hello world\nsomething else\n')
          t.assert.strictEqual(length, 27)
          resolve()
        })
      })
    })
    const promise3 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })
    await Promise.all([promise1, promise2, promise3])
  })

  test('write multi-byte characters string over than maxWrite', async (t) => {
    const fakeFs = Object.create(fs)
    const MAX_WRITE = 65535
    fakeFs.write = function (fd, buf, ...args) {
      // only write byteLength === MAX_WRITE
      const _buf = Buffer.from(buf).subarray(0, MAX_WRITE).toString()
      fs.write(fd, _buf, ...args)
      setImmediate(args[args.length - 1], null, MAX_WRITE)
      fakeFs.write = function (fd, buf, ...args) {
        fs.write(fd, buf, ...args)
      }
    }
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })
    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync, maxWrite: MAX_WRITE })
    let buf = Buffer.alloc(MAX_WRITE).fill('x')
    buf = '🌲' + buf.toString()
    stream.write(buf)
    stream.end()

    const promise1 = new Promise((resolve) => {
      stream.on('finish', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.strictEqual(data, buf)
          resolve()
        })
      })
    })
    const promise2 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })
    const promise3 = new Promise((resolve) => {
      stream.on('error', () => {
        t.assert.ok('error emitted')
        resolve()
      })
    })
    await Promise.all([promise1, promise2, promise3])
  })
}

test('write buffers that are not totally written', async (t) => {
  t.plan(9)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = function (fd, buf, ...args) {
      t.assert.ok('calling real fs.write, ' + buf)
      fs.write(fd, buf, ...args)
    }
    process.nextTick(args[args.length - 1], null, 0)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: false })

  const promise1 = once(stream, 'ready', () => {
    t.assert.ok('ready emitted')
  })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  stream.end()

  const promise2 = new Promise((resolve) => {
    stream.on('finish', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.strictEqual(data, 'hello world\nsomething else\n')
        resolve()
      })
    })
  })
  const promise3 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })
  await Promise.all([promise1, promise2, promise3])
})

test('write enormously large buffers async', async (t) => {
  t.plan(3)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: false })

  const buf = Buffer.alloc(1024).fill('x').toString() // 1 MB
  let length = 0

  for (let i = 0; i < 1024 * 512; i++) {
    length += buf.length
    stream.write(buf)
  }

  stream.end()

  const promise1 = new Promise((resolve) => {
    stream.on('finish', () => {
      fs.stat(dest, (err, stat) => {
        t.assert.ifError(err)
        t.assert.strictEqual(stat.size, length)
        resolve()
      })
    })
  })
  const promise2 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })
  await Promise.all([promise1, promise2])
})

test('make sure `maxWrite` is passed', (t) => {
  const dest = file()
  const stream = new SonicBoom({ dest, maxLength: 65536 })
  t.assert.strictEqual(stream.maxLength, 65536)
})

test('write enormously large buffers async atomicly', async (t) => {
  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: false })

  const buf = Buffer.alloc(1023).fill('x').toString()

  fakeFs.write = function (fd, _buf, ...args) {
    if (_buf.length % buf.length !== 0) {
      t.fail('write called with wrong buffer size')
    }

    setImmediate(args[args.length - 1], null, _buf.length)
  }

  for (let i = 0; i < 1024 * 512; i++) {
    stream.write(buf)
  }

  setImmediate(() => {
    for (let i = 0; i < 1024 * 512; i++) {
      stream.write(buf)
    }

    stream.end()
  })

  await once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })
})

test('write should not drop new data if buffer is not full', async (t) => {
  t.plan(2)
  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 101, maxLength: 102, sync: false })

  const buf = Buffer.alloc(100).fill('x').toString()

  fakeFs.write = function (fd, _buf, ...args) {
    t.assert.strictEqual(_buf.length, buf.length + 2)
    setImmediate(args[args.length - 1], null, _buf.length)
    fakeFs.write = () => t.error('shouldnt call write again')
    stream.end()
  }

  once(stream, 'drop', () => {
    t.assert.fail('should not drop')
  })

  stream.write(buf)
  stream.write('aa')

  await once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })
})

test('write should drop new data if buffer is full', async (t) => {
  t.plan(3)
  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 101, maxLength: 102, sync: false })

  const buf = Buffer.alloc(100).fill('x').toString()

  fakeFs.write = function (fd, _buf, ...args) {
    t.assert.strictEqual(_buf.length, buf.length)
    setImmediate(args[args.length - 1], null, _buf.length)
    fakeFs.write = () => t.error('shouldnt call write more than once')
  }

  const promise1 = new Promise((resolve) => {
    stream.on('drop', (data) => {
      t.assert.strictEqual(data.length, 3)
      stream.end()
      resolve()
    })
  })

  stream.write(buf)
  stream.write('aaa')

  const promise2 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  await Promise.all([promise1, promise2])
})
