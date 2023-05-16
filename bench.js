'use strict'

const bench = require('fastbench')
const SonicBoom = require('./')
const Console = require('console').Console
const fs = require('fs')

const core = fs.createWriteStream('/dev/null')
const fd = fs.openSync('/dev/null', 'w')
const sonic = new SonicBoom({ fd })
const sonic4k = new SonicBoom({ fd, minLength: 4096 })
const sonicSync = new SonicBoom({ fd, sync: true })
const sonicSync4k = new SonicBoom({ fd, minLength: 4096, sync: true })
const dummyConsole = new Console(fs.createWriteStream('/dev/null'))

const MAX = 10000

const buf = Buffer.alloc(50, 'hello', 'utf8')
const str = buf.toString()

setTimeout(doBench, 100)

const run = bench([
  function benchSonic (cb) {
    sonic.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonic.write(str)
    }
  },
  function benchSonicSync (cb) {
    sonicSync.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonicSync.write(str)
    }
  },
  function benchSonic4k (cb) {
    sonic4k.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonic4k.write(str)
    }
  },
  function benchSonicSync4k (cb) {
    sonicSync4k.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonicSync4k.write(str)
    }
  },
  function benchCore (cb) {
    core.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      core.write(str)
    }
  },
  function benchConsole (cb) {
    for (let i = 0; i < MAX; i++) {
      dummyConsole.log(str)
    }
    setImmediate(cb)
  },
  function benchSonicBuf (cb) {
    sonic.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonic.write(buf)
    }
  },
  function benchSonicSyncBuf (cb) {
    sonicSync.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonicSync.write(buf)
    }
  },
  function benchSonic4kBuf (cb) {
    sonic4k.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonic4k.write(buf)
    }
  },
  function benchSonicSync4kBuf (cb) {
    sonicSync4k.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonicSync4k.write(buf)
    }
  },
  function benchCoreBuf (cb) {
    core.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      core.write(buf)
    }
  }
], 1000)

function doBench () {
  run(run)
}
