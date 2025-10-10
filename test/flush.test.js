'use strict'

const fs = require('fs')
const path = require('path')
const SonicBoom = require('../')
const { file, runTests, once } = require('./helper')
const proxyquire = require('proxyquire')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the unmask for testing
  process.umask(0o000)

  test('append', async (t) => {
    t.plan(3)

    const dest = file()
    fs.writeFileSync(dest, 'hello world\n')
    const stream = new SonicBoom({ dest, append: false, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('something else\n'))

    stream.flush()

    const promise2 = once(stream, 'drain', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.strictEqual(data, 'something else\n')
      stream.end()
    })

    await Promise.all([promise1, promise2])
  })

  test('mkdir', async (t) => {
    t.plan(3)

    const dest = path.join(file(), 'out.log')
    const stream = new SonicBoom({ dest, mkdir: true, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))

    stream.flush()

    const promise2 = once(stream, 'drain', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.strictEqual(data, 'hello world\n')
      stream.end()
    })

    await Promise.all([promise1, promise2])
  })

  test('flush', async (t) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.flush()

    const promise2 = once(stream, 'drain', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.strictEqual(data, 'hello world\nsomething else\n')
      stream.end()
    })

    await Promise.all([promise1, promise2])
  })

  test('flush with no data', async (t) => {
    t.plan(2)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    stream.flush()

    const promise2 = once(stream, 'drain', () => {
      t.assert.ok('drain emitted')
    })

    await Promise.all([promise1, promise2])
  })

  test('call flush cb after flushed', async (t) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    const promise2 = new Promise((resolve) => {
      stream.flush((err) => {
        if (err) t.assert.fail(err)
        else t.assert.ok('flush cb called')
        resolve()
      })
    })

    await Promise.all([promise1, promise2])
  })

  test('only call fsyncSync and not fsync when fsync: true', async (t) => {
    t.plan(6)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,
      fsync: true,
      minLength: 4096
    })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    fakeFs.fsync = function (fd, cb) {
      t.fail('fake fs.fsync called while should not')
      cb()
    }
    fakeFs.fsyncSync = function (fd) {
      t.assert.ok('fake fsyncSync called')
    }

    function successOnAsyncOrSyncFn (isSync, originalFn) {
      return function (...args) {
        t.assert.ok(`fake fs.${originalFn.name} called`)
        fakeFs[originalFn.name] = originalFn
        return fakeFs[originalFn.name](...args)
      }
    }

    if (sync) {
      fakeFs.writeSync = successOnAsyncOrSyncFn(true, fs.writeSync)
    } else {
      fakeFs.write = successOnAsyncOrSyncFn(false, fs.write)
    }

    t.assert.ok(stream.write('hello world\n'))

    const promise2 = new Promise((resolve) => {
      stream.flush((err) => {
        if (err) t.fail(err)
        else t.assert.ok('flush cb called')

        process.nextTick(() => {
          // to make sure fsync is not called as well
          t.assert.ok('nextTick after flush called')
          resolve()
        })
      })
    })

    await Promise.all([promise1, promise2])
  })

  test('call flush cb with error when fsync failed', async (t) => {
    t.plan(5)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,
      minLength: 4096
    })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    const err = new Error('other')
    err.code = 'other'

    function onFsyncOnFsyncSync (isSync, originalFn) {
      return function (...args) {
        Error.captureStackTrace(err)
        t.assert.ok(`fake fs.${originalFn.name} called`)
        fakeFs[originalFn.name] = originalFn
        const cb = args[args.length - 1]

        cb(err)
      }
    }

    // only one is called depends on sync
    fakeFs.fsync = onFsyncOnFsyncSync(false, fs.fsync)

    function successOnAsyncOrSyncFn (isSync, originalFn) {
      return function (...args) {
        t.assert.ok(`fake fs.${originalFn.name} called`)
        fakeFs[originalFn.name] = originalFn
        return fakeFs[originalFn.name](...args)
      }
    }

    if (sync) {
      fakeFs.writeSync = successOnAsyncOrSyncFn(true, fs.writeSync)
    } else {
      fakeFs.write = successOnAsyncOrSyncFn(false, fs.write)
    }

    t.assert.ok(stream.write('hello world\n'))

    const promise2 = new Promise((resolve) => {
      stream.flush((err) => {
        if (err) t.assert.strictEqual(err.code, 'other')
        else t.fail('flush cb called without an error')
        resolve()
      })
    })

    await Promise.all([promise1, promise2])
  })

  test('call flush cb even when have no data', async (t) => {
    t.plan(2)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    await promise1

    const promise2 = new Promise((resolve) => {
      stream.flush((err) => {
        if (err) t.fail(err)
        else t.assert.ok('flush cb called')
        resolve()
      })
    })

    await promise2
  })

  test('call flush cb even when minLength is 0', async (t) => {
    t.plan(1)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync })

    const promise = new Promise((resolve) => {
      stream.flush((err) => {
        if (err) t.fail(err)
        else t.assert.ok('flush cb called')
        resolve()
      })
    })

    await promise
  })

  test('call flush cb with an error when trying to flush destroyed stream', async (t) => {
    t.plan(1)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })
    stream.destroy()

    const promise = new Promise((resolve) => {
      stream.flush((err) => {
        if (err) t.assert.ok(err)
        else t.fail('flush cb called without an error')
        resolve()
      })
    })

    await promise
  })

  test('call flush cb with an error when failed to flush', async (t) => {
    t.plan(5)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,
      minLength: 4096
    })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    const err = new Error('other')
    err.code = 'other'

    function onWriteOrWriteSync (isSync, originalFn) {
      return function (...args) {
        Error.captureStackTrace(err)
        t.assert.ok(`fake fs.${originalFn.name} called`)
        fakeFs[originalFn.name] = originalFn

        if (isSync) throw err
        const cb = args[args.length - 1]

        cb(err)
      }
    }

    // only one is called depends on sync
    fakeFs.write = onWriteOrWriteSync(false, fs.write)
    fakeFs.writeSync = onWriteOrWriteSync(true, fs.writeSync)

    t.assert.ok(stream.write('hello world\n'))

    const promise2 = new Promise((resolve) => {
      stream.flush((err) => {
        if (err) t.assert.strictEqual(err.code, 'other')
        else t.fail('flush cb called without an error')
        resolve()
      })
    })

    stream.end()

    const promise3 = once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })

    await Promise.all([promise1, promise2, promise3])
  })

  test('call flush cb when finish writing when currently in the middle', async (t) => {
    t.plan(4)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,

      // to trigger write without calling flush
      minLength: 1
    })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    let flushResolve
    const flushPromise = new Promise((resolve) => {
      flushResolve = resolve
    })

    function onWriteOrWriteSync (originalFn) {
      return function (...args) {
        stream.flush((err) => {
          if (err) t.fail(err)
          else t.assert.ok('flush cb called')
          flushResolve()
        })

        t.assert.ok(`fake fs.${originalFn.name} called`)
        fakeFs[originalFn.name] = originalFn
        return originalFn(...args)
      }
    }

    // only one is called depends on sync
    fakeFs.write = onWriteOrWriteSync(fs.write)
    fakeFs.writeSync = onWriteOrWriteSync(fs.writeSync)

    t.assert.ok(stream.write('hello world\n'))

    await Promise.all([promise1, flushPromise])
  })

  test('call flush cb when writing and trying to flush before ready (on async)', async (t) => {
    t.plan(4)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    let flushResolve
    const flushPromise = new Promise((resolve) => {
      flushResolve = resolve
    })

    fakeFs.open = fsOpen

    const dest = file()
    const stream = new SonicBoom({
      fd: dest,
      // only async as sync is part of the constructor so the user will not be able to call write/flush
      // before ready
      sync: false,

      // to not trigger write without calling flush
      minLength: 4096
    })

    const promise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    function fsOpen (...args) {
      process.nextTick(() => {
        // try writing and flushing before ready and in the middle of opening
        t.assert.ok('fake fs.open called')
        t.assert.ok(stream.write('hello world\n'))

        // calling flush
        stream.flush((err) => {
          if (err) t.fail(err)
          else t.assert.ok('flush cb called')
          flushResolve()
        })

        fakeFs.open = fs.open
        fs.open(...args)
      })
    }

    await Promise.all([promise1, flushPromise])
  })
}
