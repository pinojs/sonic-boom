'use strict'

const test = require('node:test')
const fs = require('node:fs')
const SonicBoom = require('../')
const { file } = require('./helper')

const MAX_WRITE = 16 * 1024

test('drain deadlock', (t, end) => {
  t.plan(4)

  const dest = file()
  const stream = new SonicBoom({ dest, sync: false, minLength: 9999 })

  t.assert.ok(stream.write(Buffer.alloc(1500).fill('x').toString()))
  t.assert.ok(stream.write(Buffer.alloc(1500).fill('x').toString()))
  t.assert.ok(!stream.write(Buffer.alloc(MAX_WRITE).fill('x').toString()))
  stream.on('drain', () => {
    t.assert.ok('pass')
    end()
  })
})

test('should throw if minLength >= maxWrite', (t) => {
  t.plan(1)
  t.assert.throws(() => {
    const dest = file()
    const fd = fs.openSync(dest, 'w')

    SonicBoom({
      fd,
      minLength: MAX_WRITE
    })
  })
})
