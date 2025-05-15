'use strict'

const { describe, test, after } = require('node:test')
const fs = require('fs')
const os = require('os')
const path = require('path')

const files = []
let count = 0

function file () {
  const file = path.join(os.tmpdir(), `sonic-boom-${process.pid}-${process.hrtime().toString()}-${count++}`)
  files.push(file)
  return file
}

after(() => {
  const rmSync = fs.rmSync || fs.rmdirSync
  files.forEach((file) => {
    try {
      if (fs.existsSync(file)) {
        fs.statSync(file).isDirectory() ? rmSync(file, { recursive: true, maxRetries: 10 }) : fs.unlinkSync(file)
      }
    } catch (e) {
      console.log(e)
    }
  })
})

async function runTests (buildTests) {
  describe('sync false', () => {
    buildTests(test, false)
  })

  describe('sync true', () => {
    buildTests(test, true)
  })
}

/**
 * Listens for an event on an object and resolves a promise when the event is emitted.
 * @param {Object} emitter - The object to listen to.
 * @param {string} event - The name of the event to listen for.
 * @param {Function} fn - The function to call when the event is emitted.
 * @returns {Promise} A promise that resolves when the event is emitted.
 */
function once (emitter, event, fn) {
  return new Promise(resolve => {
    emitter.on(event, (...args) => {
      fn(...args)
      resolve()
    })
  })
}

module.exports = { file, runTests, once }
