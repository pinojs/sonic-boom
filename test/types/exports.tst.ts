/* eslint-disable new-cap */
import { expect, test } from 'tstyche'

import SonicBoom, { type SonicBoomOpts } from '../../index.js'
import SonicBoomDefault, { SonicBoom as SonicBoomNamed } from '../../index.js'
import * as SonicBoomStar from '../../index.js'
import SonicBoomCjsImport = require('../../index.js')

declare const options: SonicBoomOpts

test('exports', () => {
  expect(new SonicBoomDefault(options)).type.toBe<SonicBoom>()
  expect(new SonicBoomNamed(options)).type.toBe<SonicBoom>()
  expect(new SonicBoomStar.SonicBoom(options)).type.toBe<SonicBoom>()
  expect(new SonicBoomStar.default(options)).type.toBe<SonicBoom>()
  expect(new SonicBoomCjsImport.SonicBoom(options)).type.toBe<SonicBoom>()
  expect(new SonicBoomCjsImport.default(options)).type.toBe<SonicBoom>()
})
