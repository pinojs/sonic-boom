'use strict'

const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const SonicBoom = require('../')
const { file } = require('./helper')
const proxyquire = require('proxyquire')

for (const sync in [true, false]) {
  // Reset the unmask for testing
  process.umask(0o000)

  test('append', (t, end) => {
    t.plan(4)

    const dest = file()
    fs.writeFileSync(dest, 'hello world\n')
    const stream = new SonicBoom({ dest, append: false, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('something else\n'))

    stream.flush()

    stream.on('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, 'something else\n')
        stream.end()
        end()
      })
    })
  })

  test('mkdir', (t, end) => {
    t.plan(4)

    const dest = path.join(file(), 'out.log')
    const stream = new SonicBoom({ dest, mkdir: true, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))

    stream.flush()

    stream.on('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, 'hello world\n')
        stream.end()
        end()
      })
    })
  })

  test('flush', (t, end) => {
    t.plan(5)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.flush()

    stream.on('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, 'hello world\nsomething else\n')
        stream.end()
        end()
      })
    })
  })

  test('flush with no data', (t, end) => {
    t.plan(2)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    stream.flush()

    stream.on('drain', () => {
      t.assert.ok('drain emitted')
      end()
    })
  })

  test('call flush cb after flushed', (t, end) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.flush((err) => {
      if (err) t.assert.fail(err)
      else t.assert.ok('flush cb called')
      end()
    })
  })

  test('only call fsyncSync and not fsync when fsync: true', (t, end) => {
    t.plan(6)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,
      fsync: true,
      minLength: 4096
    })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    fakeFs.fsync = function (fd, cb) {
      t.assert.fail('fake fs.fsync called while should not')
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
    stream.flush((err) => {
      if (err) t.assert.fail(err)
      else t.assert.ok('flush cb called')

      process.nextTick(() => {
        // to make sure fsync is not called as well
        t.assert.ok('nextTick after flush called')
        end()
      })
    })
  })

  test('call flush cb with error when fsync failed', (t, end) => {
    t.plan(5)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,
      minLength: 4096
    })

    stream.on('ready', () => {
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
    stream.flush((err) => {
      if (err) t.assert.equal(err.code, 'other')
      else t.assert.fail('flush cb called without an error')
      end()
    })
  })

  test('call flush cb even when have no data', (t, end) => {
    t.plan(2)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')

      stream.flush((err) => {
        if (err) t.assert.fail(err)
        else t.assert.ok('flush cb called')
        end()
      })
    })
  })

  test('call flush cb even when minLength is 0', (t, end) => {
    t.plan(1)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync })

    stream.flush((err) => {
      if (err) t.assert.fail(err)
      else t.assert.ok('flush cb called')
      end()
    })
  })

  test('call flush cb with an error when trying to flush destroyed stream', (t, end) => {
    t.plan(1)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })
    stream.destroy()

    stream.flush((err) => {
      if (err) t.assert.ok(err)
      else t.assert.fail('flush cb called without an error')
      end()
    })
  })

  test('call flush cb with an error when failed to flush', (t, end) => {
    t.plan(5)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,
      minLength: 4096
    })

    stream.on('ready', () => {
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
    stream.flush((err) => {
      if (err) t.assert.equal(err.code, 'other')
      else t.assert.fail('flush cb called without an error')
    })

    stream.end()

    stream.on('close', () => {
      t.assert.ok('close emitted')
      end()
    })
  })

  test('call flush cb when finish writing when currently in the middle', (t, end) => {
    t.plan(4)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({
      fd,
      sync,

      // to trigger write without calling flush
      minLength: 1
    })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    function onWriteOrWriteSync (originalFn) {
      return function (...args) {
        stream.flush((err) => {
          if (err) t.assert.fail(err)
          else t.assert.ok('flush cb called')
          end()
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
  })

  test('call flush cb when writing and trying to flush before ready (on async)', (t, end) => {
    t.plan(4)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
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

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    function fsOpen (...args) {
      process.nextTick(() => {
        // try writing and flushing before ready and in the middle of opening
        t.assert.ok('fake fs.open called')
        t.assert.ok(stream.write('hello world\n'))

        // calling flush
        stream.flush((err) => {
          if (err) t.assert.fail(err)
          else t.assert.ok('flush cb called')
          end()
        })

        fakeFs.open = fs.open
        fs.open(...args)
      })
    }
  })
}

for (const sync of [false, true]) {
  for (const contentMode of ['utf8', 'buffer']) {
    const toData = (str) => contentMode === 'buffer' ? Buffer.from(str) : str

    test(`flush with minLength 0 waits for the in-flight write (sync: ${sync}, ${contentMode})`, (t, end) => {
      t.plan(4)

      const dest = file()
      const fd = fs.openSync(dest, 'w')
      const stream = new SonicBoom({ fd, minLength: 0, sync, contentMode })

      let flushed = false
      t.assert.ok(stream.write(toData('hello world\n')))
      stream.flush((err) => {
        t.assert.ifError(err)
        flushed = true
        t.assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world\n')
        stream.end()
        end()
      })
      // in sync mode the write already completed, so the cb may run synchronously
      t.assert.equal(flushed, sync)
    })

    test(`end waits for a pending flush (sync: ${sync}, ${contentMode})`, (t, end) => {
      t.plan(4)

      const dest = file()
      const fd = fs.openSync(dest, 'w')
      const stream = new SonicBoom({ fd, minLength: 4096, sync, contentMode })

      let flushed = false
      t.assert.ok(stream.write(toData('hello world\n')))
      stream.flush((err) => {
        t.assert.ifError(err)
        flushed = true
      })
      stream.on('close', () => {
        t.assert.ok(flushed, 'flush cb called before close')
        t.assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world\n')
        end()
      })
      stream.end()
    })
  }

  test(`concurrent flush calls are all called before close (sync: ${sync})`, (t, end) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    let count = 0
    t.assert.ok(stream.write('hello world\n'))
    stream.flush((err) => { t.assert.ifError(err); count++ })
    stream.flush((err) => { t.assert.ifError(err); count++ })
    stream.on('close', () => {
      t.assert.equal(count, 2)
      end()
    })
    stream.end()
  })

  test(`end closes the stream after a failed fsync in flush (sync: ${sync})`, (t, end) => {
    t.plan(2)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    const flushError = new Error('flush failed')
    let fsyncCalls = 0
    fakeFs.fsync = function (fd, cb) {
      fsyncCalls++
      process.nextTick(cb, fsyncCalls === 1 ? flushError : null)
    }

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 4096, sync })

    stream.write('hello world\n')
    stream.flush((err) => {
      t.assert.equal(err, flushError)
    })
    stream.on('close', () => {
      t.assert.ok('close emitted')
      end()
    })
    stream.end()
  })

  test(`flush does not fsync stdout (sync: ${sync})`, (t, end) => {
    t.plan(2)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    let fsyncCalls = 0
    fakeFs.fsync = function (fd, cb) {
      fsyncCalls++
      process.nextTick(cb)
    }

    const stream = new SonicBoom({ fd: 1, minLength: 4096, sync })

    stream.flush((err) => {
      t.assert.ifError(err)
      t.assert.equal(fsyncCalls, 0)
      end()
    })
  })
}

test('destroy while opening with a pending end does not throw', (t, end) => {
  t.plan(1)

  const stream = new SonicBoom({ dest: file(), sync: false })
  stream.end()
  stream.destroy()
  stream.on('close', () => {
    t.assert.ok('close emitted')
    end()
  })
})

test('end while opening after destroy does not throw', (t, end) => {
  t.plan(1)

  const stream = new SonicBoom({ dest: file(), sync: false })
  stream.destroy()
  stream.end()
  stream.on('close', () => {
    t.assert.ok('close emitted')
    end()
  })
})

test('destroy while opening fails a pending flush', (t, end) => {
  t.plan(2)

  const stream = new SonicBoom({ dest: file(), sync: false })
  stream.flush((err) => {
    t.assert.equal(err.message, 'SonicBoom destroyed')
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
    end()
  })
  stream.destroy()
})
