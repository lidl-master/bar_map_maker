// CLI: `node tools/bar/locate.js` prints the user's Beyond All Reason install as JSON. The logic lives in src/bar.
import { locateBar } from '../../src/bar/locate.js';

export { locateBar };

if (import.meta.main) console.log(JSON.stringify(locateBar(), null, 2));
