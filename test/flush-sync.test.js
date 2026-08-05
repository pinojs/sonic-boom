'use strict'

const { test } = require('tap')
const fs = require('fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file, runTests } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('flushSync', (t) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    t.ok(stream.write('hello world\n'))
    t.ok(stream.write('something else\n'))

    stream.flushSync()

    // let the file system settle down things
    setImmediate(function () {
      stream.end()
      const data = fs.readFileSync(dest, 'utf8')
      t.equal(data, 'hello world\nsomething else\n')

      stream.on('close', () => {
        t.pass('close emitted')
      })
    })
  })
}

test('flushSync opens the fd synchronously when called before the async open completes (append, default)', (t) => {
  t.plan(3)

  const dest = file()
  // No fd/no sync:true - the constructor's fs.open() for `dest` is still
  // in flight when flushSync() runs immediately after, mirroring
  // process.exit() firing right after creating the destination.
  const stream = new SonicBoom({ dest })

  t.ok(stream.write('hello world\n'))
  t.doesNotThrow(() => stream.flushSync())

  const data = fs.readFileSync(dest, 'utf8')
  t.equal(data, 'hello world\n')

  stream.destroy()
})

test('flushSync still throws when not ready and append is false, since a second open would truncate', (t) => {
  t.plan(2)

  const dest = file()
  const stream = new SonicBoom({ dest, append: false })

  t.ok(stream.write('hello world\n'))
  t.throws(() => stream.flushSync(), /sonic boom is not ready yet/)

  stream.destroy()
})

test('ready still fires exactly once, and the original async open does not clobber data written by the flushSync fallback', (t) => {
  t.plan(4)

  // Hold the constructor's fs.open() callback instead of letting it fire,
  // so the "async open completes after the fallback already ran" race is
  // deterministic instead of relying on a timer.
  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  let capturedOpenCallback
  fakeFs.open = function (path, flags, mode, cb) {
    capturedOpenCallback = cb
  }

  const stream = new SonicBoom({ dest })

  let readyCount = 0
  stream.on('ready', () => {
    readyCount++
  })

  t.ok(stream.write('first\n'))
  stream.flushSync() // fakeFs.open never called back - forces the sync fallback
  const fdAfterFallback = stream.fd

  // Now resolve the held-open callback with a genuine fd, simulating the
  // original async open finally completing after the fallback already took
  // over. It should be treated as redundant: closed, not applied.
  fs.open(dest, 'a', stream.mode, (err, redundantFd) => {
    t.error(err)
    capturedOpenCallback(null, redundantFd)

    t.equal(readyCount, 1)
    t.equal(stream.fd, fdAfterFallback)

    stream.destroy()
  })
})

test('flushBufferSync opens the fd synchronously when called before the async open completes (contentMode: buffer)', (t) => {
  t.plan(3)

  const dest = file()
  const stream = new SonicBoom({ dest, contentMode: 'buffer' })

  t.ok(stream.write(Buffer.from('hello world\n')))
  t.doesNotThrow(() => stream.flushSync())

  const data = fs.readFileSync(dest, 'utf8')
  t.equal(data, 'hello world\n')

  stream.destroy()
})

test('a ready listener calling destroy() does not lose the data the flushSync fallback was about to write', (t) => {
  t.plan(3)

  const dest = file()
  const stream = new SonicBoom({ dest })

  // destroy() clears buffered writes (see actualClose) - if 'ready' fired
  // before the write, this would wipe the data flushSync is trying to flush.
  stream.on('ready', () => {
    stream.destroy()
  })

  t.ok(stream.write('hello world\n'))
  t.doesNotThrow(() => stream.flushSync())

  const data = fs.readFileSync(dest, 'utf8')
  t.equal(data, 'hello world\n')
})

test('a throwing ready listener propagates its own error instead of "sonic boom is not ready yet"', (t) => {
  t.plan(2)

  const dest = file()
  const stream = new SonicBoom({ dest })

  const boom = new Error('boom from ready listener')
  stream.on('ready', () => {
    throw boom
  })

  t.ok(stream.write('hello world\n'))
  // The listener's throw must propagate, not get swallowed and reported
  // back as "sonic boom is not ready yet".
  t.throws(() => stream.flushSync(), boom)

  stream.destroy()
})

test('retry in flushSync on EAGAIN', (t) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: false, minLength: 0 })

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  t.ok(stream.write('hello world\n'))

  fakeFs.writeSync = function (fd, buf, enc) {
    t.pass('fake fs.write called')
    fakeFs.writeSync = fs.writeSync
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
  }

  t.ok(stream.write('something else\n'))

  stream.flushSync()
  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\nsomething else\n')
    })
  })
  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('throw error in flushSync on EAGAIN', (t) => {
  t.plan(12)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 1000,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.equal(err.code, 'EAGAIN')
      t.equal(writeBufferLen, 12)
      t.equal(remainingBufferLen, 0)
      return false
    }
  })

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  const err = new Error('EAGAIN')
  err.code = 'EAGAIN'
  fakeFs.writeSync = function (fd, buf, enc) {
    Error.captureStackTrace(err)
    t.pass('fake fs.write called')
    fakeFs.writeSync = fs.writeSync
    throw err
  }

  fakeFs.fsyncSync = function (...args) {
    t.pass('fake fs.fsyncSync called')
    fakeFs.fsyncSync = fs.fsyncSync
    return fs.fsyncSync.apply(null, args)
  }

  t.ok(stream.write('hello world\n'))
  t.throws(stream.flushSync.bind(stream), err, 'EAGAIN')

  t.ok(stream.write('something else\n'))
  stream.flushSync()

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\nsomething else\n')
    })
  })
  stream.on('close', () => {
    t.pass('close emitted')
  })
})
