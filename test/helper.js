'use strict'

const tap = require('tap')
const nodeTest = require('node:test')
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

nodeTest.after(() => {
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

function runTestsLegacy (buildTests) {
  tap.test('sync false', (t) => {
    buildTests(t.test, false)
    t.end()
  })

  tap.test('sync true', (t) => {
    buildTests(t.test, true)
    t.end()
  })
}

async function runTests (buildTests) {
  nodeTest.describe('sync false', () => {
    buildTests(nodeTest.test, false)
  })

  nodeTest.describe('sync true', () => {
    buildTests(nodeTest.test, true)
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

module.exports = { file, runTestsLegacy, runTests, once }
