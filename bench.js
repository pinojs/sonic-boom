'use strict'

var bench = require('fastbench')
var SonicBoom = require('./')
var fs = require('fs')

var core = fs.createWriteStream('/dev/null')
var fd = fs.openSync('/dev/null', 'w')
var sonic = new SonicBoom(fd)

setTimeout(doBench, 100)

var run = bench([
  function benchSonic (cb) {
    sonic.once('drain', cb)
    for (var i = 0; i < 10000; i++) {
      sonic.write('hello world')
    }
  },
  function benchCore (cb) {
    core.once('drain', cb)
    for (var i = 0; i < 10000; i++) {
      core.write('hello world')
    }
  }
], 1000)

function doBench () {
  run(run)
}
