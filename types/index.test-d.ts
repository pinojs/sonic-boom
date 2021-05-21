import { expectType } from "tsd";
import SonicBoom, { SonicBoom as SonicBoomNamed } from "../";
import SonicBoomDefault from "../";
import * as SonicBoomStar from "../";
import SonicBoomCjsImport = require ("../");
const SonicBoomCjs = require("../");
const { SonicBoom: SonicBoomCjsNamed } = require('SonicBoom')

const sonic = new SonicBoom(1);

expectType<SonicBoom>(new SonicBoomNamed(1));
expectType<SonicBoom>( new SonicBoomDefault(1));
expectType<SonicBoom>( new SonicBoomStar.SonicBoom(1));
expectType<SonicBoom>( new SonicBoomStar.default(1));
expectType<SonicBoom>( new SonicBoomCjsImport.SonicBoom(1));
expectType<SonicBoom>( new SonicBoomCjsImport.default(1));
expectType<any>( new SonicBoomCjs(1));
expectType<any>( new SonicBoomCjsNamed(1));

sonic.write('hello sonic\n');

sonic.flush();

sonic.flushSync();

sonic.reopen();

sonic.end();

sonic.destroy();

const extraSonic = new SonicBoom(1, 0, true);

extraSonic.write('extra sonic\n');
