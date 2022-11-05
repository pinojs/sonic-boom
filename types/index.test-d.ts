import { expectType } from "tsd";
import SonicBoom, { SonicBoom as SonicBoomNamed } from "../";
import SonicBoomDefault from "../";
import * as SonicBoomStar from "../";
import SonicBoomCjsImport = require ("../");
const SonicBoomCjs = require("../");
const { SonicBoom: SonicBoomCjsNamed } = require('SonicBoom');

const sonic = new SonicBoom({ fd: 1});

expectType<SonicBoom>(new SonicBoomNamed({ fd: 1}));
expectType<SonicBoom>( new SonicBoomDefault({ fd: 1}));
expectType<SonicBoom>( new SonicBoomStar.SonicBoom({ fd: 1}));
expectType<SonicBoom>( new SonicBoomStar.default({ fd: 1}));
expectType<SonicBoom>( new SonicBoomCjsImport.SonicBoom({ fd: 1}));
expectType<SonicBoom>( new SonicBoomCjsImport.default({ fd: 1}));
expectType<any>( new SonicBoomCjs({ fd: 1}));
expectType<any>( new SonicBoomCjsNamed({ fd: 1}));

expectType<boolean>(sonic.write('hello sonic\n'));

sonic.flush();

sonic.flushSync();

sonic.reopen();

sonic.end();

sonic.destroy();

const extraSonic = new SonicBoom({fd: 1, minLength: 0, maxWrite: 16384, sync: true, append: true, mode: 0o644, mkdir: true});
new SonicBoom({fd: 1, minLength: 0, maxWrite: 16384, sync: true, append: true, mode: 0o644, mkdir: true, dest: '/dev/null'});
new SonicBoom({fd: 1, minLength: 0, maxWrite: 16384, sync: true, append: true, mode: 0o644, mkdir: true, dest: 1});
new SonicBoom({fd: 1, minLength: 0, maxWrite: 16384, sync: true, fsync: true, append: true, mode: 0o644, mkdir: true});

extraSonic.write('extra sonic\n');
