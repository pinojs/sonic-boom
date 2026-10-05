'use strict'

const test = require('node:test')
const fs = require('node:fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file } = require('./helper')

for (const sync in [true, false]) {
  // Reset the umask for testing
  process.umask(0o000)

  test('flushSync', (t, end) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.flushSync()

    // let the file system settle down things
    setImmediate(function () {
      stream.end()
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.equal(data, 'hello world\nsomething else\n')

      stream.on('close', () => {
        t.assert.ok('close emitted')
        end()
      })
    })
  })
}

test('retry in flushSync on EAGAIN', (t, end) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: false, minLength: 0 })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  t.assert.ok(stream.write('hello world\n'))

  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.write called')
    fakeFs.writeSync = fs.writeSync
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
  }

  t.assert.ok(stream.write('something else\n'))

  stream.flushSync()
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

test('throw error in flushSync on EAGAIN', (t, end) => {
  t.plan(12)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 1000,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.equal(err.code, 'EAGAIN')
      t.assert.equal(writeBufferLen, 12)
      t.assert.equal(remainingBufferLen, 0)
      return false
    }
  })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  const err = new Error('EAGAIN')
  err.code = 'EAGAIN'
  fakeFs.writeSync = function (fd, buf, enc) {
    Error.captureStackTrace(err)
    t.assert.ok('fake fs.write called')
    fakeFs.writeSync = fs.writeSync
    throw err
  }

  fakeFs.fsyncSync = function (...args) {
    t.assert.ok('fake fs.fsyncSync called')
    fakeFs.fsyncSync = fs.fsyncSync
    return fs.fsyncSync.apply(null, args)
  }

  t.assert.ok(stream.write('hello world\n'))
  t.assert.throws(stream.flushSync.bind(stream), err, 'EAGAIN')

  t.assert.ok(stream.write('something else\n'))
  stream.flushSync()

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

for (const contentMode of ['utf8', 'buffer']) {
  const toData = (str) => contentMode === 'buffer' ? Buffer.from(str) : str

  test(`flushSync while an async write is in flight writes the queued data (${contentMode})`, (t, end) => {
    t.plan(4)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    let completeWrite
    fakeFs.write = function (fd, buf, ...args) {
      const cb = args.pop()
      completeWrite = () => cb(null, fs.writeSync(fd, buf))
    }

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync: false, contentMode })

    stream.on('ready', () => {
      stream.write(toData('in flight\n'))
      t.assert.equal(stream._writing, true)
      stream.write(toData('queued\n'))
      stream.flushSync()
      t.assert.equal(fs.readFileSync(dest, 'utf8'), 'queued\n')

      stream.flush((err) => {
        t.assert.ifError(err)
        stream.on('finish', () => {
          t.assert.equal(fs.readFileSync(dest, 'utf8'), 'queued\nin flight\n')
          end()
        })
        stream.end()
      })
      completeWrite()
    })
  })

  test(`flushSync while waiting to retry EAGAIN writes everything in order (${contentMode})`, (t, end) => {
    t.plan(5)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    fakeFs.write = function (fd, buf, ...args) {
      const cb = args.pop()
      const err = new Error('EAGAIN')
      err.code = 'EAGAIN'
      process.nextTick(cb, err)
    }

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync: false, contentMode })

    stream.on('ready', () => {
      stream.write(toData('hello\n'))
      // Wait for the EAGAIN to schedule the retry.
      setImmediate(() => {
        t.assert.equal(stream._writing, true)
        stream.write(toData('world\n'))
        // A pending flush() completes once flushSync() takes over the write.
        stream.flush((err) => {
          t.assert.ifError(err)
          stream.on('finish', () => {
            t.assert.equal(fs.readFileSync(dest, 'utf8'), 'hello\nworld\n')
            end()
          })
          stream.end()
        })
        stream.flushSync()
        t.assert.equal(stream._writing, false)
        t.assert.equal(fs.readFileSync(dest, 'utf8'), 'hello\nworld\n')
      })
    })
  })

  for (const sync of [true, false]) {
    test(`flushSync from a 'write' listener writes the remainder of a partial write first (sync: ${sync}, ${contentMode})`, (t, end) => {
      t.plan(4)

      const fakeFs = Object.create(fs)
      const SonicBoom = proxyquire('../', {
        'node:fs': fakeFs
      })

      let partial = true
      const partialWrite = (fd, buf) => {
        if (partial) {
          partial = false
          return fs.writeSync(fd, Buffer.from(buf).subarray(0, 5))
        }
        return fs.writeSync(fd, buf)
      }
      fakeFs.writeSync = (fd, buf) => partialWrite(fd, buf)
      fakeFs.write = (fd, buf, ...args) => {
        const cb = args.pop()
        process.nextTick(cb, null, partialWrite(fd, buf))
      }

      const dest = file()
      const fd = fs.openSync(dest, 'w')
      const stream = new SonicBoom({ fd, minLength: 0, sync, contentMode })

      stream.once('write', (n) => {
        t.assert.equal(n, 5)
        t.assert.equal(stream._writing, true)
        stream.write(toData('next\n'))
        stream.flushSync()
        t.assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world\nnext\n')
      })

      stream.on('ready', () => {
        stream.write(toData('hello world\n'))
        stream.on('finish', () => {
          t.assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world\nnext\n')
          end()
        })
        stream.end()
      })
    })
  }
}

test('flushSync while reopening writes to the previous file', (t, end) => {
  t.plan(3)

  const dest = file()
  const stream = new SonicBoom({ dest, minLength: 4096, sync: false })

  stream.once('ready', () => {
    stream.write('before reopen\n')
    stream.reopen()
    t.assert.equal(stream._writing, true)
    stream.flushSync()
    t.assert.equal(fs.readFileSync(dest, 'utf8'), 'before reopen\n')
    stream.once('ready', () => {
      stream.on('finish', () => {
        t.assert.equal(fs.readFileSync(dest, 'utf8'), 'before reopen\n')
        end()
      })
      stream.end()
    })
  })
})
