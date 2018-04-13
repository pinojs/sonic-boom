'use strict'

const fs = require('fs')
const EventEmitter = require('events')
const reusify = require('reusify')
const flatstr = require('flatstr')
const inherits = require('util').inherits

function Holder () {
  EventEmitter.call(this)

  this.sonic = null
  var that = this
  this.release = function (err) {
    var sonic = that.sonic
    if (err) {
      sonic.emit('error', err)
      return
    }

    pool.release(that)

    if (sonic._buf.length > 0) {
      actualWrite(sonic)
    } else if (sonic._ending === true) {
      actualClose(sonic)
    } else {
      sonic._writing = false
      sonic.emit('drain')
    }
  }
}

const pool = reusify(Holder)

function SonicBoom (fd) {
  if (!(this instanceof SonicBoom)) {
    return new SonicBoom(fd)
  }

  this._buf = ''
  this.fd = -1
  this._writing = false
  this._ending = false
  this.destroyed = false

  if (typeof fd === 'number') {
    this.fd = fd
    process.nextTick(() => this.emit('ready'))
  } else if (typeof fd === 'string') {
    this._writing = true
    fs.open(fd, 'a', (err, fd) => {
      if (err) {
        this.emit('error', err)
        return
      }

      this.emit('ready')

      this.fd = fd
      this._writing = false
      // start
      if (this._buf.length > 0) {
        actualWrite(this)
      }
    })
  } else {
    throw new Error('SonicBoom supports only file descriptors and files')
  }
}

inherits(SonicBoom, EventEmitter)

SonicBoom.prototype.write = function (data) {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }
  this._buf += data
  if (this._writing === false) {
    actualWrite(this)
  }
  return this._buf.length < 16384
}

SonicBoom.prototype.end = function () {
  if (this._writing === true) {
    this._ending = true
    return
  }

  actualClose(this)
}

SonicBoom.prototype.flushSync = function () {
  if (this.fd < 0) {
    throw new Error('sonic boom is not ready yet')
  }

  if (this._buf.length > 0) {
    fs.writeSync(this.fd, this._buf, 'utf8')
  }
}

SonicBoom.prototype.destroy = function () {
  actualClose(this)
}

function actualWrite (sonic) {
  const holder = pool.get()
  holder.sonic = sonic
  sonic._writing = true
  flatstr(sonic._buf)
  fs.write(sonic.fd, sonic._buf, 'utf8', holder.release)
  sonic._buf = ''
}

function actualClose (sonic) {
  // TODO write a test to check if we are not leaking fds
  fs.close(sonic.fd, (err) => {
    if (err) {
      sonic.emit('error', err)
      return
    }

    sonic.emit('finish')
  })
  sonic.destroyed = true
  sonic._buf = ''
}

module.exports = SonicBoom
