'use strict'

const { test } = require('node:test')
const fs = require('fs')
const proxyquire = require('proxyquire')
const { file, runTests, once } = require('./helper')

const MAX_WRITE = 16 * 1024

runTests(buildTests)

function buildTests (test) {
  // Reset the umask for testing
  process.umask(0o000)
  test('retry on EAGAIN', async (t) => {
    t.plan(6)

    const fakeFs = Object.create(fs)
    fakeFs.write = function (fd, buf, ...args) {
      t.assert.ok('fake fs.write called')
      fakeFs.write = fs.write
      const err = new Error('EAGAIN')
      err.code = 'EAGAIN'
      process.nextTick(args.pop(), err)
    }
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync: false, minLength: 0 })

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

    return await Promise.all([promise1, promise2, promise3])
  })
}

test('emit error on async EAGAIN', async (t) => {
  t.plan(10)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    process.nextTick(args[args.length - 1], err)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 12,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.strictEqual(err.code, 'EAGAIN')
      t.assert.strictEqual(writeBufferLen, 12)
      t.assert.strictEqual(remainingBufferLen, 0)
      return false
    }
  })

  const promise1 = once(stream, 'ready', () => {
    t.assert.ok('ready emitted')
  })

  const promise2 = once(stream, 'error', err => {
    t.assert.strictEqual(err.code, 'EAGAIN')
    t.assert.ok(stream.write('something else\n'))
  })

  t.assert.ok(stream.write('hello world\n'))

  stream.end()

  const promise3 = once(stream, 'finish', () => {
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\nsomething else\n')
  })
  const promise4 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  return await Promise.all([promise1, promise2, promise3, promise4])
})

test('retry on EAGAIN (sync)', async (t) => {
  t.plan(6)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.writeSync called')
    fakeFs.writeSync = fs.writeSync
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
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

  return await Promise.all([promise1, promise2, promise3])
})

test('emit error on EAGAIN (sync)', async (t) => {
  t.plan(10)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.writeSync called')
    fakeFs.writeSync = fs.writeSync
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    minLength: 0,
    sync: true,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.strictEqual(err.code, 'EAGAIN')
      t.assert.strictEqual(writeBufferLen, 12)
      t.assert.strictEqual(remainingBufferLen, 0)
      return false
    }
  })

  const promise1 = once(stream, 'ready', () => {
    t.assert.ok('ready emitted')
  })

  const promise2 = once(stream, 'error', err => {
    t.assert.strictEqual(err.code, 'EAGAIN')
    t.assert.ok(stream.write('something else\n'))
  })

  t.assert.ok(stream.write('hello world\n'))

  stream.end()

  const promise3 = once(stream, 'finish', () => {
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\nsomething else\n')
  })

  const promise4 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  return await Promise.all([promise1, promise2, promise3, promise4])
})

test('retryEAGAIN receives remaining buffer on async if write fails', async (t) => {
  t.plan(11)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 12,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.strictEqual(err.code, 'EAGAIN')
      t.assert.strictEqual(writeBufferLen, 12)
      t.assert.strictEqual(remainingBufferLen, 11)
      return false
    }
  })

  const promise1 = once(stream, 'ready', () => {
    t.assert.ok('ready emitted')
  })

  const promise2 = once(stream, 'error', err => {
    t.assert.strictEqual(err.code, 'EAGAIN')
    t.assert.ok(stream.write('done'))
  })

  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    t.assert.ok(stream.write('sonic boom\n'))
    process.nextTick(args[args.length - 1], err)
  }

  t.assert.ok(stream.write('hello world\n'))

  stream.end()

  const promise3 = once(stream, 'finish', () => {
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\nsonic boom\ndone')
  })
  const promise4 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  return await Promise.all([promise1, promise2, promise3, promise4])
})

test('retryEAGAIN receives remaining buffer if exceeds maxWrite', async (t) => {
  t.plan(16)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const buf = Buffer.alloc(MAX_WRITE - 2).fill('x').toString() // 1 MB
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: MAX_WRITE - 1,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.strictEqual(err.code, 'EAGAIN', 'retryEAGAIN received EAGAIN error')
      t.assert.strictEqual(writeBufferLen, buf.length, 'writeBufferLen === buf.length')
      t.assert.strictEqual(remainingBufferLen, 23, 'remainingBufferLen === 23')
      return false
    }
  })

  const promise1 = once(stream, 'ready', () => {
    t.assert.ok('ready emitted')
  })

  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    process.nextTick(args.pop(), err)
  }

  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.write called')
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
  }

  t.assert.ok(stream.write(buf), 'write buf')
  t.assert.ok(!stream.write('hello world\nsonic boom\n'), 'write hello world sonic boom')

  const promise2 = once(stream, 'error', err => {
    t.assert.strictEqual(err.code, 'EAGAIN', 'bubbled error should be EAGAIN')

    try {
      stream.flushSync()
    } catch (err) {
      t.assert.strictEqual(err.code, 'EAGAIN', 'thrown error should be EAGAIN')
      fakeFs.write = fs.write
      fakeFs.writeSync = fs.writeSync
      stream.end()
    }
  })

  const promise3 = once(stream, 'finish', () => {
    t.assert.ok('finish emitted')
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, `${buf}hello world\nsonic boom\n`, 'data on file should match written')
  })

  const promise4 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  return await Promise.all([promise1, promise2, promise3, promise4])
})

test('retry on EBUSY', async (t) => {
  t.plan(6)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EBUSY')
    err.code = 'EBUSY'
    process.nextTick(args.pop(), err)
  }
  const SonicBoom = proxyquire('..', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: false, minLength: 0 })

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

  return await Promise.all([promise1, promise2, promise3])
})

test('emit error on async EBUSY', async (t) => {
  t.plan(10)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EBUSY')
    err.code = 'EBUSY'
    process.nextTick(args.pop(), err)
  }
  const SonicBoom = proxyquire('..', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 12,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.strictEqual(err.code, 'EBUSY')
      t.assert.strictEqual(writeBufferLen, 12)
      t.assert.strictEqual(remainingBufferLen, 0)
      return false
    }
  })

  const promise1 = once(stream, 'ready', () => {
    t.assert.ok('ready emitted')
  })

  const promise2 = once(stream, 'error', err => {
    t.assert.strictEqual(err.code, 'EBUSY')
    t.assert.ok(stream.write('something else\n'))
  })

  t.assert.ok(stream.write('hello world\n'))

  stream.end()

  const promise3 = once(stream, 'finish', () => {
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\nsomething else\n')
  })
  const promise4 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  return await Promise.all([promise1, promise2, promise3, promise4])
})
