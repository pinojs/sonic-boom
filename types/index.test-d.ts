import { SonicBoom } from "../";
import SonicBoomEsm from "../";
import * as SonicBoomStar from "../";
const sonic = new SonicBoom(1)
const sonic2 = new SonicBoomEsm(1)
const sonic3 = new SonicBoomStar.SonicBoom(1)
const sonic4 = new SonicBoomStar.default(1)

sonic.write('hello sonic\n');

sonic.flush();

sonic.flushSync();

sonic.reopen();

sonic.end();

sonic.destroy();

const extraSonic = new SonicBoom(1, 0, true);

extraSonic.write('extra sonic\n');
