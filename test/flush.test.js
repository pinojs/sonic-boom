'use strict'

const fs = require('fs')
const path = require('path')
const SonicBoom = require('../')
const { file, runTests } = require('./helper')
const proxyquire = require('proxyquire')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the unmask for testing
  process.umask(0o000)

  test('append', (t) => {
    t.plan(4)

    const dest = file()
    fs.writeFileSync(dest, 'hello world\n')
    const stream = new SonicBoom({ dest, append: false, sync })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    t.ok(stream.write('something else\n'))

    stream.flush()

    stream.on('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, 'something else\n')
        stream.end()
      })
    })
  })

  test('mkdir', (t) => {
    t.plan(4)

    const dest = path.join(file(), 'out.log')
    const stream = new SonicBoom({ dest, mkdir: true, sync })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    t.ok(stream.write('hello world\n'))

    stream.flush()

    stream.on('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, 'hello world\n')
        stream.end()
      })
    })
  })

  test('flush', (t) => {
    t.plan(5)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    t.ok(stream.write('hello world\n'))
    t.ok(stream.write('something else\n'))

    stream.flush()

    stream.on('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, 'hello world\nsomething else\n')
        stream.end()
      })
    })
  })

  test('flush with no data', (t) => {
    t.plan(2)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    stream.flush()

    stream.on('drain', () => {
      t.pass('drain emitted')
    })
  })

  test('call flush cb after flushed', (t) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    t.ok(stream.write('hello world\n'))
    t.ok(stream.write('something else\n'))

    stream.flush((err) => {
      if (err) t.fail(err)
      else t.pass('flush cb called')
    })
  })

  test('only call fsyncSync and not fsync when fsync: true', (t) => {
    t.plan(6)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync: false,
      fsync: true,
      minLength: 4096
    })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    fakeFs.fsync = function (fd, cb) {
      t.fail('fake fs.fsync called while should not')
      cb()
    }
    fakeFs.fsyncSync = function (fd) {
      t.pass('fake fsyncSync called')
    }

    fakeFs.write = function (...args) {
      t.pass('fake fs.write called')
      fakeFs.write = fs.write
      return fakeFs.write(...args)
    }

    t.ok(stream.write('hello world\n'))
    stream.flush((err) => {
      if (err) t.fail(err)
      else t.pass('flush cb called')

      process.nextTick(() => {
        // to make sure fsync is not called as well
        t.pass('nextTick after flush called')
      })
    })
  })

  test('call flush cb with error when fsync failed', (t) => {
    t.plan(5)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync: false,
      minLength: 4096
    })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    const err = new Error('other')
    err.code = 'other'
    fakeFs.fsync = function (fd, cb) {
      fakeFs.fsync = fs.fsync
      Error.captureStackTrace(err)
      t.pass('fake fs.fsync called')
      cb(err)
    }

    fakeFs.write = function (...args) {
      t.pass('fake fs.write called')
      fakeFs.write = fs.write
      return fakeFs.write(...args)
    }

    t.ok(stream.write('hello world\n'))
    stream.flush((err) => {
      if (err) t.equal(err.code, 'other')
      else t.fail('flush cb called without an error')
    })
  })

  test('call flush cb even when have no data', (t) => {
    t.plan(2)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.pass('ready emitted')

      stream.flush((err) => {
        if (err) t.fail(err)
        else t.pass('flush cb called')
      })
    })
  })

  test('call flush cb even when minLength is 0', (t) => {
    t.plan(1)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync })

    stream.flush((err) => {
      if (err) t.fail(err)
      else t.pass('flush cb called')
    })
  })

  test('call flush cb with an error when trying to flush destroyed stream', (t) => {
    t.plan(1)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })
    stream.destroy()

    stream.flush((err) => {
      if (err) t.pass(err)
      else t.fail('flush cb called without an error')
    })
  })

  test('call flush cb with an error when failed to flush', (t) => {
    t.plan(5)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync: false,
      minLength: 4096
    })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    const err = new Error('other')
    err.code = 'other'
    fakeFs.write = function (fd, buf, enc, cb) {
      fakeFs.write = fs.write
      Error.captureStackTrace(err)
      t.pass('fake fs.write called')
      cb(err)
    }

    t.ok(stream.write('hello world\n'))
    stream.flush((err) => {
      if (err) t.equal(err.code, 'other')
      else t.fail('flush cb called without an error')
    })

    stream.end()

    stream.on('close', () => {
      t.pass('close emitted')
    })
  })

  test('call flush cb when finish writing when currently in the middle', (t) => {
    t.plan(4)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync: false,

      // to trigger write without calling flush
      minLength: 1
    })

    stream.on('ready', () => {
      t.pass('ready emitted')
    })

    fakeFs.write = function (...args) {
      stream.flush((err) => {
        if (err) t.fail(err)
        else t.pass('flush cb called')
      })

      t.pass('fake fs.write called')
      fakeFs.write = fs.write
      return fakeFs.write(...args)
    }

    t.ok(stream.write('hello world\n'))
  })
}
