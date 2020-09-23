import { SonicBoom as SonicBoomNamed } from "../";
import SonicBoomDefault from "../";
import * as SonicBoomStar from "../";
import SonicBoomCjsImport = require ("../");
const SonicBoomCjs = require("../");
const { SonicBoom } = require('SonicBoom')

const sonic = new SonicBoomNamed(1)
const sonic2 = new SonicBoomDefault(1)
const sonic3 = new SonicBoomStar.SonicBoom(1)
const sonic4 = new SonicBoomStar.default(1)
const sonic5 = new SonicBoomCjsImport.SonicBoom(1)
const sonic6 = new SonicBoomCjsImport.default(1)
const sonic7 = new SonicBoomCjs(1);
const sonic8 = new SonicBoom(1);

sonic.write('hello sonic\n');

sonic.flush();

sonic.flushSync();

sonic.reopen();

sonic.end();

sonic.destroy();

const extraSonic = new SonicBoom(1, 0, true);

extraSonic.write('extra sonic\n');
