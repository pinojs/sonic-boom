'use strict'

const test = require('node:test')
const fs = require('node:fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file, runTests } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
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
    fs: fakeFs
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
    fs: fakeFs
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
