'use strict'

const fs = require('fs')
const EventEmitter = require('events')
const flatstr = require('flatstr')
const inherits = require('util').inherits

function SonicBoom (fd, minLength) {
  if (!(this instanceof SonicBoom)) {
    return new SonicBoom(fd, minLength)
  }

  this._buf = ''
  this.fd = -1
  this._writing = false
  this._ending = false
  this.destroyed = false

  this.minLength = minLength || 0

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

      this.fd = fd
      this._writing = false

      this.emit('ready')

      // start
      var len = this._buf.length
      if (len > 0 && len > this.minLength && !this.destroyed) {
        actualWrite(this)
      }
    })
  } else {
    throw new Error('SonicBoom supports only file descriptors and files')
  }

  this.release = (err) => {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this.destroyed) {
      return
    }

    var len = this._buf.length
    if (this._buf.length > 0 && len > this.minLength) {
      actualWrite(this)
    } else if (this._ending) {
      if (len > 0) {
        actualWrite(this)
      } else {
        this._writing = false
        actualClose(this)
      }
    } else {
      this._writing = false
      this.emit('drain')
    }
  }
}

inherits(SonicBoom, EventEmitter)

SonicBoom.prototype.write = function (data) {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }
  this._buf += data
  var len = this._buf.length
  if (!this._writing && len > this.minLength) {
    actualWrite(this)
  }
  return len < 16384
}

SonicBoom.prototype.flush = function () {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  if (this._writing || this.minLength <= 0) {
    return
  }

  actualWrite(this)
}

SonicBoom.prototype.end = function () {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  if (this._ending) {
    return
  }

  this._ending = true

  if (!this._writing && this._buf.length > 0 && this.fd >= 0) {
    actualWrite(this)
    return
  }

  if (this._writing) {
    return
  }

  actualClose(this)
}

SonicBoom.prototype.flush = function () {
  if (this._writing === false) {
    actualWrite(this)
  }
}

SonicBoom.prototype.flushSync = function () {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  if (this.fd < 0) {
    throw new Error('sonic boom is not ready yet')
  }

  if (this._buf.length > 0) {
    fs.writeSync(this.fd, this._buf, 'utf8')
    this._buf = ''
  }

  this._buf = ''
  this._writing = false
}

SonicBoom.prototype.destroy = function () {
  if (this.destroyed) {
    return
  }
  actualClose(this)
}

function actualWrite (sonic) {
  sonic._writing = true
  flatstr(sonic._buf)
  fs.write(sonic.fd, sonic._buf, 'utf8', sonic.release)
  sonic._buf = ''
}

function actualClose (sonic) {
  if (sonic.fd === -1) {
    sonic.once('ready', actualClose.bind(null, sonic))
    return
  }
  // TODO write a test to check if we are not leaking fds
  fs.close(sonic.fd, (err) => {
    if (err) {
      sonic.emit('error', err)
      return
    }

    if (sonic._ending && !sonic._writing) {
      sonic.emit('finish')
    }
    sonic.emit('close')
  })
  sonic.destroyed = true
  sonic._buf = ''
}

module.exports = SonicBoom
