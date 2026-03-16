'use strict'

const test = require('node:test')
const fs = require('fs')
const proxyquire = require('proxyquire')
const { file } = require('./helper')

test('fsync with sync', (t, end) => {
  t.plan(5)

  const fakeFs = Object.create(fs)
  fakeFs.fsyncSync = function (fd) {
    t.assert.ok('fake fs.fsyncSync called')
    return fs.fsyncSync(fd)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: true, fsync: true })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  stream.end()

  const data = fs.readFileSync(dest, 'utf8')
  t.assert.equal(data, 'hello world\nsomething else\n')

  end()
})

test('fsync with async', (t, end) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  fakeFs.fsyncSync = function (fd) {
    t.assert.ok('fake fs.fsyncSync called')
    return fs.fsyncSync(fd)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, fsync: true })

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
